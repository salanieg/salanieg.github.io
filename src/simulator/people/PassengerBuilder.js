import * as THREE from 'three';

export class PassengerBuilder {
    constructor() {
        this.materials = {};
    }

    getMaterial(colorHex) {
        if (!this.materials[colorHex]) {
            const baseColor = new THREE.Color(colorHex);
            baseColor.multiplyScalar(0.5); // Dim by 50%
            this.materials[colorHex] = new THREE.MeshBasicMaterial({ color: baseColor, fog: false });
        }
        return this.materials[colorHex];
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
        if (this.materials[cacheKey]) {
            return this.materials[cacheKey];
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

        this.materials[cacheKey] = material;
        return material;
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

        // Bounding box: X: [-0.25, 0.25], Y: [0, 1.0], Z: [-0.15, 0.15]
        
        // 1. Shoes
        const shoeGeom = new THREE.BoxGeometry(0.1, 0.05, 0.14);
        const shoeL = new THREE.Mesh(shoeGeom, shoesMat);
        shoeL.position.set(-0.06, 0.025, 0.02);
        const shoeR = new THREE.Mesh(shoeGeom, shoesMat);
        shoeR.position.set(0.06, 0.025, 0.02);
        group.add(shoeL, shoeR);

        // 2. Legs (Total Y: [0.0, 0.45])
        if (options.pantsStyle === 'shorts') {
            const upperLegGeom = new THREE.BoxGeometry(0.08, 0.2, 0.08);
            const lowerLegGeom = new THREE.BoxGeometry(0.08, 0.2, 0.08);
            
            const upperL = new THREE.Mesh(upperLegGeom, pantsMat);
            upperL.position.set(-0.06, 0.35, 0);
            const lowerL = new THREE.Mesh(lowerLegGeom, skinMat);
            lowerL.position.set(-0.06, 0.15, 0);

            const upperR = new THREE.Mesh(upperLegGeom, pantsMat);
            upperR.position.set(0.06, 0.35, 0);
            const lowerR = new THREE.Mesh(lowerLegGeom, skinMat);
            lowerR.position.set(0.06, 0.15, 0);

            group.add(upperL, lowerL, upperR, lowerR);
        } else if (options.pantsStyle === 'skirt') {
            const legGeom = new THREE.BoxGeometry(0.08, 0.4, 0.08);
            const legL = new THREE.Mesh(legGeom, skinMat);
            legL.position.set(-0.06, 0.25, 0);
            const legR = new THREE.Mesh(legGeom, skinMat);
            legR.position.set(0.06, 0.25, 0);
            group.add(legL, legR);

            const skirtGeom = new THREE.BoxGeometry(0.24, 0.22, 0.16);
            const skirtMesh = new THREE.Mesh(skirtGeom, pantsMat);
            skirtMesh.position.set(0, 0.44, 0);
            group.add(skirtMesh);
        } else if (options.pantsStyle === 'dress') {
            const legGeom = new THREE.BoxGeometry(0.08, 0.4, 0.08);
            const legL = new THREE.Mesh(legGeom, skinMat);
            legL.position.set(-0.06, 0.25, 0);
            const legR = new THREE.Mesh(legGeom, skinMat);
            legR.position.set(0.06, 0.25, 0);
            group.add(legL, legR);

            const skirtGeom = new THREE.BoxGeometry(0.24, 0.26, 0.16);
            const dressMesh = new THREE.Mesh(skirtGeom, shirtMat);
            dressMesh.position.set(0, 0.46, 0);
            group.add(dressMesh);
        } else if (options.pantsStyle === 'latz') {
            // Dungarees (Latzhose)
            const legGeom = new THREE.BoxGeometry(0.08, 0.4, 0.08);
            const legL = new THREE.Mesh(legGeom, pantsMat);
            legL.position.set(-0.06, 0.25, 0);
            const legR = new THREE.Mesh(legGeom, pantsMat);
            legR.position.set(0.06, 0.25, 0);
            group.add(legL, legR);
            
            // Bib part
            const bibGeom = new THREE.BoxGeometry(0.22, 0.15, 0.135);
            const bib = new THREE.Mesh(bibGeom, pantsMat);
            bib.position.set(0, 0.525, 0.005);
            group.add(bib);
        } else if (options.pantsStyle === 'jeans_torn') {
            // Torn jeans: show skin color boxes around knee level (Y = 0.25)
            const legGeom = new THREE.BoxGeometry(0.08, 0.4, 0.08);
            const legL = new THREE.Mesh(legGeom, pantsMat);
            legL.position.set(-0.06, 0.25, 0);
            const legR = new THREE.Mesh(legGeom, pantsMat);
            legR.position.set(0.06, 0.25, 0);
            
            const ripL = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.04, 0.082), skinMat);
            ripL.position.set(-0.06, 0.24, 0.005);
            const ripR = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.04, 0.082), skinMat);
            ripR.position.set(0.06, 0.24, 0.005);
            
            group.add(legL, legR, ripL, ripR);
        } else {
            // Standard long pants
            const legGeom = new THREE.BoxGeometry(0.08, 0.4, 0.08);
            const legL = new THREE.Mesh(legGeom, pantsMat);
            legL.position.set(-0.06, 0.25, 0);
            const legR = new THREE.Mesh(legGeom, pantsMat);
            legR.position.set(0.06, 0.25, 0);
            group.add(legL, legR);
        }

        // 3. Torso (Total Y: [0.45, 0.80])
        const hasVest = (options.vestColor !== undefined);
        const vestMat = hasVest ? this.getMaterial(options.vestColor) : null;

        if (options.pantsStyle === 'dress') {
            const torsoGeom = new THREE.BoxGeometry(0.22, 0.35, 0.13);
            const torsoMesh = new THREE.Mesh(torsoGeom, shirtMat);
            torsoMesh.position.set(0, 0.625, 0);
            group.add(torsoMesh);
        } else if (options.shirtStyle === 'crop') {
            const upperTorsoGeom = new THREE.BoxGeometry(0.22, 0.2, 0.13);
            const lowerTorsoGeom = new THREE.BoxGeometry(0.22, 0.15, 0.13);
            
            const upperTorso = new THREE.Mesh(upperTorsoGeom, shirtMat);
            upperTorso.position.set(0, 0.70, 0);
            const lowerTorso = new THREE.Mesh(lowerTorsoGeom, skinMat);
            lowerTorso.position.set(0, 0.525, 0);
            
            group.add(upperTorso, lowerTorso);
        } else {
            const torsoGeom = new THREE.BoxGeometry(0.22, 0.35, 0.13);
            const torsoMesh = new THREE.Mesh(torsoGeom, shirtMat);
            torsoMesh.position.set(0, 0.625, 0);
            group.add(torsoMesh);

            // Overlay vest if specified
            if (hasVest) {
                const vestGeom = new THREE.BoxGeometry(0.23, 0.34, 0.14);
                const vestMesh = new THREE.Mesh(vestGeom, vestMat);
                vestMesh.position.set(0, 0.62, 0);
                group.add(vestMesh);
            }
        }

        // 4. Back Decal (Orange square on back of torso for Mann)
        if (options.backDecal === 'orange_square') {
            const decalGeom = new THREE.BoxGeometry(0.12, 0.12, 0.015);
            const orangeMat = this.getMaterial('#ff6600');
            const decal = new THREE.Mesh(decalGeom, orangeMat);
            decal.position.set(0, 0.65, -0.066);
            group.add(decal);
        }

        // 5. Neck (Y: [0.80, 0.83])
        const neckGeom = new THREE.BoxGeometry(0.05, 0.03, 0.05);
        const neck = new THREE.Mesh(neckGeom, skinMat);
        neck.position.set(0, 0.815, 0);
        group.add(neck);

        // 6. Head (Y: [0.83, 0.98])
        const headGeom = new THREE.BoxGeometry(0.14, 0.15, 0.14);
        const head = new THREE.Mesh(headGeom, skinMat);
        head.position.set(0, 0.905, 0);
        group.add(head);

        // 7. Hair Styles & Caps
        const isBeanie = options.hairStyle === 'beanie';
        const isBeanieHipster = options.hairStyle === 'beanie_hipster';
        const isAnglerHat = options.hairStyle === 'angler_hat';
        const isFlatCap = options.hairStyle === 'flatcap';
        const isHat = options.hairStyle === 'hat' || options.hairStyle === 'hat_white';
        const isHelmet = options.hairStyle === 'helmet';
        const isBikeHelmet = options.hairStyle === 'bikehelmet';
        const isMotoHelmet = options.hairStyle === 'helmet_moto';
        
        // Build base hair block if not completely enclosed by helmet
        if (!isMotoHelmet) {
            const hairCapGeom = new THREE.BoxGeometry(0.152, 0.09, 0.16);
            const cap = new THREE.Mesh(hairCapGeom, hairMat);
            cap.position.set(0, 0.945, -0.008);
            group.add(cap);

            if (options.hairStyle === 'ponytail') {
                const backHairGeom = new THREE.BoxGeometry(0.150, 0.12, 0.05);
                const back = new THREE.Mesh(backHairGeom, hairMat);
                back.position.set(0, 0.88, -0.065);

                const zopfGeom = new THREE.BoxGeometry(0.04, 0.06, 0.08);
                const zopf = new THREE.Mesh(zopfGeom, hairMat);
                zopf.position.set(0, 0.90, -0.13);

                const bandGeom = new THREE.BoxGeometry(0.046, 0.046, 0.015);
                const band = new THREE.Mesh(bandGeom, this.getMaterial('#111111'));
                band.position.set(0, 0.90, -0.095);

                group.add(back, zopf, band);
            } else if (options.hairStyle === 'long') {
                const backHairGeom = new THREE.BoxGeometry(0.150, 0.22, 0.042);
                const back = new THREE.Mesh(backHairGeom, hairMat);
                back.position.set(0, 0.81, -0.07);

                const strandGeom = new THREE.BoxGeometry(0.022, 0.22, 0.09);
                const strandL = new THREE.Mesh(strandGeom, hairMat);
                strandL.position.set(-0.066, 0.81, -0.01);

                const strandR = new THREE.Mesh(strandGeom, hairMat);
                strandR.position.set(0.066, 0.81, -0.01);

                group.add(back, strandL, strandR);
            } else if (options.hairStyle === 'bun') {
                // white/grey knot on top of head
                const bunGeom = new THREE.BoxGeometry(0.06, 0.06, 0.06);
                const bun = new THREE.Mesh(bunGeom, hairMat);
                bun.position.set(0, 1.00, -0.02);
                group.add(bun);
            } else if (options.hairStyle === 'water') {
                // dark hair with blue pixels
                const backHairGeom = new THREE.BoxGeometry(0.150, 0.08, 0.05);
                const back = new THREE.Mesh(backHairGeom, hairMat);
                back.position.set(0, 0.88, -0.065);
                group.add(back);

                // Add 2 cyan water droplet boxes
                const dropMat = this.getMaterial('#00bfff');
                const dropL = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.02), dropMat);
                dropL.position.set(-0.06, 0.92, 0.071);
                const dropR = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.02), dropMat);
                dropR.position.set(0.05, 0.89, 0.071);
                group.add(dropL, dropR);
            } else if (options.hairStyle === 'cap_backward') {
                // Baseball cap turned backwards
                const capMat = this.getMaterial('#dc2626'); // red cap
                const capDome = new THREE.Mesh(new THREE.BoxGeometry(0.154, 0.06, 0.154), capMat);
                capDome.position.set(0, 0.965, 0);
                const capBrim = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.01, 0.08), capMat);
                capBrim.position.set(0, 0.94, -0.10);
                group.add(capDome, capBrim);
            } else {
                const backHairGeom = new THREE.BoxGeometry(0.150, 0.08, 0.05);
                const back = new THREE.Mesh(backHairGeom, hairMat);
                back.position.set(0, 0.88, -0.065);
                group.add(back);
            }
        }

        // 7b. Headwear (Beanies, Helmets, Hats)
        if (isBeanie || isBeanieHipster) {
            const beanieMat = this.getMaterial(isBeanieHipster ? '#8b4513' : '#111111');
            const beanieGeom = new THREE.BoxGeometry(0.156, 0.07, 0.156);
            const beanie = new THREE.Mesh(beanieGeom, beanieMat);
            beanie.position.set(0, 0.97, -0.005);
            group.add(beanie);
        } else if (isHat) {
            const hatColor = options.hairStyle === 'hat_white' ? '#f8fafc' : '#111111';
            const hatMat = this.getMaterial(hatColor);
            
            // Brim (Krempe)
            const brimGeom = new THREE.BoxGeometry(0.24, 0.015, 0.24);
            const brim = new THREE.Mesh(brimGeom, hatMat);
            brim.position.set(0, 0.96, 0);
            
            // Crown (Zylinder)
            const crownGeom = new THREE.BoxGeometry(0.15, 0.06, 0.15);
            const crown = new THREE.Mesh(crownGeom, hatMat);
            crown.position.set(0, 0.99, 0);
            
            group.add(brim, crown);
        } else if (isHelmet) {
            // Construction steel helmet (Halbkreis gelb, Radius 6px -> 0.09m)
            const helmMat = this.getMaterial('#ffd700');
            const helmGeom = new THREE.SphereGeometry(0.09, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2);
            const helm = new THREE.Mesh(helmGeom, helmMat);
            helm.position.set(0, 0.96, 0);
            helm.scale.set(1.0, 0.7, 1.0);
            group.add(helm);
        } else if (isBikeHelmet) {
            const helmMat = this.getMaterial('#1a1a1a');
            const helmGeom = new THREE.BoxGeometry(0.156, 0.07, 0.165);
            const helm = new THREE.Mesh(helmGeom, helmMat);
            helm.position.set(0, 0.97, 0);
            
            // White stripes
            const stripeMat = this.getMaterial('#ffffff');
            const strL = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.074, 0.168), stripeMat);
            strL.position.set(-0.04, 0.97, 0);
            const strR = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.074, 0.168), stripeMat);
            strR.position.set(0.04, 0.97, 0);
            
            group.add(helm, strL, strR);
        } else if (isAnglerHat) {
            const hatMat = this.getMaterial('#2e8b57'); // camo green
            const brim = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.015, 0.20), hatMat);
            brim.position.set(0, 0.955, 0);
            const dome = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.06, 0.15), hatMat);
            dome.position.set(0, 0.98, 0);
            group.add(brim, dome);
        } else if (isFlatCap) {
            const capMat = this.getMaterial('#8b5a2b'); // brown Schiebermütze
            const cap = new THREE.Mesh(new THREE.BoxGeometry(0.156, 0.06, 0.16), capMat);
            cap.position.set(0, 0.965, -0.01);
            const visor = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.01, 0.04), capMat);
            visor.position.set(0, 0.94, 0.09);
            group.add(cap, visor);
        } else if (isMotoHelmet) {
            // Full-enclosing motorcycle helmet
            const helmMat = this.getMaterial('#111111');
            const helm = new THREE.Mesh(new THREE.BoxGeometry(0.158, 0.165, 0.158), helmMat);
            helm.position.set(0, 0.905, 0);
            
            // Dark visor window
            const visorMat = this.getMaterial('#000000');
            const visor = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.01), visorMat);
            visor.position.set(0, 0.915, 0.075);
            
            group.add(helm, visor);
        }

        // 8. Arms (Total Y: [0.48, 0.80])
        let armLMat = skinMat;
        let armRMat = skinMat;

        if (options.shirtStyle === 'long_sleeve' || options.shirtStyle === 'tie' || options.shirtStyle === 'doctor' || options.shirtStyle === 'evening') {
            armLMat = shirtMat;
            armRMat = shirtMat;
        }

        const isSprint = options.pose === 'sprint';
        const isBent = options.pose === 'bent';

        if (options.shirtStyle === 'tshirt' || options.shirtStyle === 'striped' || options.shirtStyle === 'logo' || options.shirtStyle === 'fcn' || options.shirtStyle === 'greuther') {
            const upperArmGeom = new THREE.BoxGeometry(0.06, 0.1, 0.06);
            const lowerArmGeom = new THREE.BoxGeometry(0.05, 0.22, 0.05);

            const upperArmL = new THREE.Mesh(upperArmGeom, shirtMat);
            upperArmL.position.set(-0.145, 0.75, 0);
            const lowerArmL = new THREE.Mesh(lowerArmGeom, skinMat);
            lowerArmL.position.set(-0.145, 0.59, 0);

            const upperArmR = new THREE.Mesh(upperArmGeom, shirtMat);
            upperArmR.position.set(0.145, 0.75, 0);
            const lowerArmR = new THREE.Mesh(lowerArmGeom, skinMat);
            lowerArmR.position.set(0.145, 0.59, 0);

            if (isSprint) {
                // Swing arms for sprint pose
                upperArmL.rotation.x = Math.PI / 4;
                lowerArmL.position.set(-0.145, 0.62, 0.08);
                upperArmR.rotation.x = -Math.PI / 4;
                lowerArmR.position.set(0.145, 0.56, -0.08);
            }

            group.add(upperArmL, lowerArmL, upperArmR, lowerArmR);
        } else {
            const armGeom = new THREE.BoxGeometry(0.06, 0.32, 0.06);
            const armL = new THREE.Mesh(armGeom, armLMat);
            armL.position.set(-0.145, 0.64, 0);
            const armR = new THREE.Mesh(armGeom, armRMat);
            armR.position.set(0.145, 0.64, 0);

            if (isSprint) {
                armL.rotation.x = Math.PI / 4;
                armL.position.set(-0.145, 0.64, 0.08);
                armR.rotation.x = -Math.PI / 4;
                armR.position.set(0.145, 0.64, -0.08);
            } else if (isBent) {
                // Arms holding massive package
                armL.rotation.x = -Math.PI / 3;
                armL.position.set(-0.145, 0.62, 0.10);
                armR.rotation.x = -Math.PI / 3;
                armR.position.set(0.145, 0.62, 0.10);
            }

            group.add(armL, armR);
        }

        // 9. Facial details & Accessories
        if (options.sunglasses || options.glasses === 'sunglasses') {
            const glassesGeom = new THREE.BoxGeometry(0.148, 0.03, 0.015);
            const glassesMat = this.getMaterial('#222222');
            const glasses = new THREE.Mesh(glassesGeom, glassesMat);
            glasses.position.set(0, 0.905, 0.071);
            group.add(glasses);
        } else if (options.glasses) {
            const gColor = options.glasses === 'red' ? '#dc2626' : (options.glasses === 'horn' ? '#5c4033' : '#111111');
            const glassesMat = this.getMaterial(gColor);
            
            if (options.glasses === 'monocle') {
                // Gold ring on right eye
                const ringMat = this.getMaterial('#ffd700');
                const ring = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.01), ringMat);
                ring.position.set(0.03, 0.91, 0.071);
                group.add(ring);
            } else {
                // Two 2x2 px frames (approx 0.03x0.03 in local space)
                const fL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.01), glassesMat);
                fL.position.set(-0.03, 0.91, 0.071);
                const fR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.01), glassesMat);
                fR.position.set(0.03, 0.91, 0.071);
                const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, 0.01), glassesMat);
                bridge.position.set(0, 0.91, 0.071);
                
                group.add(fL, fR, bridge);
            }
        }

        // Beards
        if (options.beardColor) {
            const bMat = this.getMaterial(options.beardColor);
            if (options.beardColor === '#808080' && options.item === 'breze') {
                // mustache (grauer Schnurrbart)
                const mustache = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.02, 0.02), bMat);
                mustache.position.set(0, 0.865, 0.071);
                group.add(mustache);
            } else {
                // Full beard block (Vollbart-Block)
                const beard = new THREE.Mesh(new THREE.BoxGeometry(0.142, 0.06, 0.06), bMat);
                beard.position.set(0, 0.84, 0.04);
                group.add(beard);
            }
        }

        // Tired eyes / Augenringe
        if (options.tired === 'eyes') {
            const ringMat = this.getMaterial('#374151');
            const rL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.01, 0.01), ringMat);
            rL.position.set(-0.03, 0.88, 0.071);
            const rR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.01, 0.01), ringMat);
            rR.position.set(0.03, 0.88, 0.071);
            group.add(rL, rR);
        } else if (options.tired === 'heavy_eyes') {
            const lidMat = this.getMaterial('#94a3b8');
            const rL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.015, 0.01), lidMat);
            rL.position.set(-0.03, 0.915, 0.071);
            const rR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.015, 0.01), lidMat);
            rR.position.set(0.03, 0.915, 0.071);
            group.add(rL, rR);
        }

        // Sweat droplets
        if (options.sweat === 'forehead' || options.sweat === 'soaked') {
            const sweatMat = this.getMaterial('#87cefa');
            const dropL = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.02, 0.01), sweatMat);
            dropL.position.set(-0.05, 0.93, 0.071);
            const dropR = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.02, 0.01), sweatMat);
            dropR.position.set(0.05, 0.92, 0.071);
            group.add(dropL, dropR);
        }

        // Bandage
        if (options.bandage) {
            const bandMat = this.getMaterial('#ffffff');
            const band = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.07), bandMat);
            band.position.set(-0.145, 0.58, 0); // on the left forearm
            group.add(band);
        }

        // Pose mod: bent or lookup
        if (isBent) {
            // Lean torso forward
            group.children.forEach(c => {
                if (c.position.y > 0.45 && c !== shoeL && c !== shoeR) {
                    c.position.z += 0.05;
                }
            });
        } else if (options.pose === 'lookup') {
            // Tilt head up (meaning shift cap/hair back and glasses up)
            group.children.forEach(c => {
                if (c.position.y >= 0.83 && c !== neck) {
                    c.position.y += 0.01;
                    c.position.z -= 0.02;
                }
            });
        }

        // 10. Items Construction
        if (options.item) {
            this.buildItem(group, options.item, skinMat);
        }

        // Scale entire group to match target height (bounding box is 1.0 high)
        const scale = options.height || 1.80;
        group.scale.set(scale, scale, scale);

        // Tag group as passenger for Raycaster lookup and click response
        group.userData = { isPassenger: true, config: options };

        return group;
    }

    buildItem(mainGroup, item, skinMat) {
        const hR = new THREE.Vector3(0.145, 0.48, 0.05); // Right Hand
        const hL = new THREE.Vector3(-0.145, 0.48, 0.05); // Left Hand

        const itemTempGroup = new THREE.Group();
        const group = itemTempGroup;

        switch (item) {
            case 'wanderstock': {
                const stock = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.5, 0.015), this.getMaterial('#8b4513'));
                stock.position.set(hR.x, 0.25, hR.z + 0.05);
                group.add(stock);
                break;
            }
            case 'einkaufsnetz': {
                const net = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.02), this.getMaterial('#f5deb3'));
                net.position.set(hL.x, 0.38, hL.z);
                
                // Fine line handles
                const strap = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.08, 0.01), this.getMaterial('#8b4513'));
                strap.position.set(hL.x, 0.44, hL.z);
                
                group.add(net, strap);
                break;
            }
            case 'schulranzen': {
                const pack = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.13, 0.06), this.getMaterial('#ffff00'));
                pack.position.set(0, 0.63, -0.095);
                
                const refMat = this.getMaterial('#c0c0c0');
                const strip1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.015, 0.005), refMat);
                strip1.position.set(0, 0.66, -0.126);
                const strip2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.015, 0.005), refMat);
                strip2.position.set(0, 0.60, -0.126);
                
                group.add(pack, strip1, strip2);
                break;
            }
            case 'hundeleine': {
                // Dog group - bypass automated scaling and draw at double-size directly
                const dogGroup = new THREE.Group();
                const dogMat = this.getMaterial('#8b5a2b'); // brown dog
                const earMat = this.getMaterial('#5c4033'); // dark brown ears
                const noseMat = this.getMaterial('#111111'); // black nose
                
                // Body
                const body = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.16, 0.36), dogMat);
                body.position.set(0, 0.16, 0);
                dogGroup.add(body);
                
                // Head
                const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), dogMat);
                head.position.set(0, 0.28, 0.16);
                dogGroup.add(head);
                
                // Nose
                const nose = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), noseMat);
                nose.position.set(0, 0.28, 0.26);
                dogGroup.add(nose);

                // Ears
                const earL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.04), earMat);
                earL.position.set(-0.084, 0.30, 0.12);
                const earR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.04), earMat);
                earR.position.set(0.084, 0.30, 0.12);
                dogGroup.add(earL, earR);

                // Legs
                const legGeom = new THREE.BoxGeometry(0.05, 0.12, 0.05);
                const legFL = new THREE.Mesh(legGeom, dogMat);
                legFL.position.set(-0.07, 0.06, 0.12);
                const legFR = new THREE.Mesh(legGeom, dogMat);
                legFR.position.set(0.07, 0.06, 0.12);
                const legBL = new THREE.Mesh(legGeom, dogMat);
                legBL.position.set(-0.07, 0.06, -0.12);
                const legBR = new THREE.Mesh(legGeom, dogMat);
                legBR.position.set(0.07, 0.06, -0.12);
                dogGroup.add(legFL, legFR, legBL, legBR);
                
                // Tail
                const tail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.03), dogMat);
                tail.position.set(0, 0.26, -0.18);
                tail.rotation.x = -Math.PI / 4;
                dogGroup.add(tail);

                // Position dog on ground
                dogGroup.position.set(0.35, 0.0, 0.50);
                mainGroup.add(dogGroup);
                
                // Thin black line leash directly connecting hand and dog's neck
                const points = [
                    new THREE.Vector3(hR.x, hR.y, hR.z),
                    new THREE.Vector3(0.35, 0.28, 0.58)
                ];
                const leashGeom = new THREE.BufferGeometry().setFromPoints(points);
                const leashMat = new THREE.LineBasicMaterial({ color: 0x000000 });
                const leash = new THREE.Line(leashGeom, leashMat);
                mainGroup.add(leash);
                break;
            }
            case 'einkaufstueten': {
                const bagL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.03), this.getMaterial('#ff00ff'));
                bagL.position.set(hL.x, 0.38, hL.z);
                const bagR = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.03), this.getMaterial('#00ffff'));
                bagR.position.set(hR.x, 0.38, hR.z);
                
                const handleL = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.01), this.getMaterial('#000000'));
                handleL.position.set(hL.x, 0.43, hL.z);
                const handleR = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.01), this.getMaterial('#000000'));
                handleR.position.set(hR.x, 0.43, hR.z);
                
                group.add(bagL, bagR, handleL, handleR);
                break;
            }
            case 'sporttasche': {
                const bag = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.07), this.getMaterial('#000080'));
                bag.position.set(hR.x, 0.38, hR.z + 0.02);
                
                // Stripes
                const strMat = this.getMaterial('#ffffff');
                const sL = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.074, 0.074), strMat);
                sL.position.set(hR.x - 0.04, 0.38, hR.z + 0.02);
                const sR = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.074, 0.074), strMat);
                sR.position.set(hR.x + 0.04, 0.38, hR.z + 0.02);
                
                group.add(bag, sL, sR);
                break;
            }
            case 'lautsprecher': {
                const spk = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.03), this.getMaterial('#1a1a1a'));
                spk.position.set(hR.x, 0.38, hR.z);
                
                const membMat = this.getMaterial('#808080');
                const mL = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.005), membMat);
                mL.position.set(hR.x - 0.02, 0.38, hR.z + 0.016);
                const mR = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.005), membMat);
                mR.position.set(hR.x + 0.02, 0.38, hR.z + 0.016);
                
                group.add(spk, mL, mR);
                break;
            }
            case 'buch': {
                const pageGeom = new THREE.BoxGeometry(0.05, 0.06, 0.005);
                const pageMat = this.getMaterial('#ffffff');
                
                const pL = new THREE.Mesh(pageGeom, pageMat);
                pL.position.set(-0.025, 0.62, 0.12);
                pL.rotation.y = Math.PI / 6;
                pL.rotation.x = -Math.PI / 8;
                
                const pR = new THREE.Mesh(pageGeom, pageMat);
                pR.position.set(0.025, 0.62, 0.12);
                pR.rotation.y = -Math.PI / 6;
                pR.rotation.x = -Math.PI / 8;
                
                group.add(pL, pR);
                break;
            }
            case 'fahrplan': {
                const sheet = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.002), this.getMaterial('#ffffff'));
                sheet.position.set(hR.x, 0.48, hR.z + 0.05);
                sheet.rotation.x = -Math.PI / 4;
                
                const header = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.01, 0.003), this.getMaterial('#dc2626'));
                header.position.set(hR.x, 0.505, hR.z + 0.025);
                header.rotation.x = -Math.PI / 4;
                
                group.add(sheet, header);
                break;
            }
            case 'smartphone': {
                const phone = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.008), this.getMaterial('#2f4f4f'));
                phone.position.set(hR.x, 0.49, hR.z + 0.04);
                phone.rotation.x = -Math.PI / 6;
                
                const screen = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.055, 0.009), this.getMaterial('#87cefa'));
                screen.position.set(hR.x, 0.49, hR.z + 0.041);
                screen.rotation.x = -Math.PI / 6;
                
                group.add(phone, screen);
                break;
            }
            case 'stahlhelm': {
                // Handled in the head section (Stahlhelm options.hairStyle === 'helmet')
                break;
            }
            case 'pommes': {
                const cup = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.04), this.getMaterial('#ff0000'));
                cup.position.set(hR.x, 0.49, hR.z + 0.02);
                
                const fryMat = this.getMaterial('#ffd700');
                for (let i = 0; i < 4; i++) {
                    const fry = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.035, 0.008), fryMat);
                    fry.position.set(hR.x + (i - 1.5) * 0.01, 0.515, hR.z + 0.02);
                    group.add(fry);
                }
                group.add(cup);
                break;
            }
            case 'trinkflasche': {
                const bottle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.03), this.getMaterial('#00bfff'));
                bottle.position.set(hR.x, 0.45, hR.z);
                const cap = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.015, 0.025), this.getMaterial('#808080'));
                cap.position.set(hR.x, 0.485, hR.z);
                group.add(bottle, cap);
                break;
            }
            case 'giesskanne': {
                const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), this.getMaterial('#2e8b57'));
                body.position.set(hR.x, 0.45, hR.z + 0.02);
                
                const spout = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.05), this.getMaterial('#2e8b57'));
                spout.position.set(hR.x, 0.45, hR.z + 0.07);
                
                group.add(body, spout);
                break;
            }
            case 'schluesselbund': {
                const ring = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.005), this.getMaterial('#a9a9a9'));
                ring.position.set(hR.x, 0.46, hR.z);
                
                const keyMat = this.getMaterial('#ffd700');
                const key1 = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.025, 0.004), keyMat);
                key1.position.set(hR.x - 0.006, 0.445, hR.z);
                const key2 = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.025, 0.004), keyMat);
                key2.position.set(hR.x + 0.006, 0.445, hR.z);
                
                group.add(ring, key1, key2);
                break;
            }
            case 'tennisball': {
                const ball = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 6), this.getMaterial('#ccff00'));
                ball.position.set(hR.x, 0.48, hR.z);
                group.add(ball);
                break;
            }
            case 'aktenkoffer': {
                const caseObj = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.04), this.getMaterial('#4a2e18'));
                caseObj.position.set(hR.x, 0.38, hR.z);
                
                const lockMat = this.getMaterial('#ffd700');
                const l1 = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.005), lockMat);
                l1.position.set(hR.x - 0.03, 0.38, hR.z + 0.021);
                const l2 = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.005), lockMat);
                l2.position.set(hR.x + 0.03, 0.38, hR.z + 0.021);
                
                group.add(caseObj, l1, l2);
                break;
            }
            case 'paket': {
                const box = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), this.getMaterial('#d2b48c'));
                box.position.set(0, 0.55, 0.12);
                
                const tapeMat = this.getMaterial('#8b4513');
                const tH = new THREE.Mesh(new THREE.BoxGeometry(0.092, 0.015, 0.092), tapeMat);
                tH.position.set(0, 0.55, 0.12);
                const tV = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.092, 0.092), tapeMat);
                tV.position.set(0, 0.55, 0.12);
                
                group.add(box, tH, tV);
                break;
            }
            case 'wartemarke': {
                const marke = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.005), this.getMaterial('#ffffff'));
                marke.position.set(hR.x, 0.48, hR.z + 0.03);
                
                const redDot = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.007), this.getMaterial('#ff0000'));
                redDot.position.set(hR.x, 0.48, hR.z + 0.031);
                
                group.add(marke, redDot);
                break;
            }
            case 'autoschluessel': {
                const fob = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.01), this.getMaterial('#000000'));
                fob.position.set(hR.x, 0.48, hR.z);
                
                const key = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.02, 0.004), this.getMaterial('#c0c0c0'));
                key.position.set(hR.x, 0.50, hR.z);
                
                group.add(fob, key);
                break;
            }
            case 'besucherausweis': {
                const card = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.035, 0.005), this.getMaterial('#ffffff'));
                card.position.set(0, 0.63, 0.072);
                
                const strapMat = this.getMaterial('#1e3a8a');
                const strapL = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.14, 0.005), strapMat);
                strapL.position.set(-0.03, 0.70, 0.05);
                strapL.rotation.y = Math.PI / 4;
                const strapR = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.14, 0.005), strapMat);
                strapR.position.set(0.03, 0.70, 0.05);
                strapR.rotation.y = -Math.PI / 4;
                
                group.add(card, strapL, strapR);
                break;
            }
            case 'schaumstoff_schwert': {
                const blade = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.22, 0.015), this.getMaterial('#c0c0c0'));
                blade.position.set(hR.x, 0.58, hR.z);
                
                const hilt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.015, 0.015), this.getMaterial('#ffd700'));
                hilt.position.set(hR.x, 0.49, hR.z);
                
                group.add(blade, hilt);
                break;
            }
            case 'akkuschrauber': {
                const drill = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.05), this.getMaterial('#008080')); // turquoise body
                drill.position.set(hR.x, 0.49, hR.z + 0.02);
                const battery = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.03, 0.02), this.getMaterial('#000000'));
                battery.position.set(hR.x, 0.46, hR.z + 0.01);
                group.add(drill, battery);
                break;
            }
            case 'flyerstapel': {
                const stack = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 0.05), this.getMaterial('#ffffff'));
                stack.position.set(hR.x, 0.49, hR.z + 0.02);
                stack.rotation.z = Math.PI / 6;
                group.add(stack);
                break;
            }
            case 'stadionwurst': {
                const roll = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.04), this.getMaterial('#f5deb3'));
                roll.position.set(hR.x, 0.49, hR.z + 0.02);
                
                const sausageMat = this.getMaterial('#8b4513');
                for (let i = 0; i < 3; i++) {
                    const sausage = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.07), sausageMat);
                    sausage.position.set(hR.x + (i - 1) * 0.018, 0.49, hR.z + 0.02);
                    group.add(sausage);
                }
                group.add(roll);
                break;
            }
            case 'bierdose': {
                const can = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.03), this.getMaterial('#c0c0c0'));
                can.position.set(hR.x, 0.46, hR.z);
                
                const band = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.02, 0.032), this.getMaterial('#dc2626'));
                band.position.set(hR.x, 0.46, hR.z);
                
                group.add(can, band);
                break;
            }
            case 'kaffeebecher': {
                const cup = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.055, 0.032), this.getMaterial('#ffffff'));
                cup.position.set(hR.x, 0.47, hR.z);
                
                const lid = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.01, 0.035), this.getMaterial('#4a2e18'));
                lid.position.set(hR.x, 0.50, hR.z);
                
                group.add(cup, lid);
                break;
            }
            case 'fahrradhelm': {
                // Handled in head section (Fahrradhelm options.hairStyle === 'bikehelmet')
                break;
            }
            case 'breze': {
                const loop = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.015), this.getMaterial('#cd853f'));
                loop.position.set(hR.x, 0.48, hR.z + 0.02);
                
                const whiteDot = this.getMaterial('#ffffff');
                const dot1 = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.005, 0.005), whiteDot);
                dot1.position.set(hR.x - 0.015, 0.49, hR.z + 0.028);
                const dot2 = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.005, 0.005), whiteDot);
                dot2.position.set(hR.x + 0.015, 0.47, hR.z + 0.028);
                
                group.add(loop, dot1, dot2);
                break;
            }
            case 'pulsuhr': {
                const watch = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.015), this.getMaterial('#000000'));
                watch.position.set(-0.145, 0.54, 0); // left wrist
                
                const glow = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.005), this.getMaterial('#00ff00'));
                glow.position.set(-0.145, 0.54, 0.01);
                
                group.add(watch, glow);
                break;
            }
            case 'notizblock': {
                const pad = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.005), this.getMaterial('#fff8dc'));
                pad.position.set(hL.x, 0.48, hL.z + 0.03);
                pad.rotation.x = -Math.PI/6;
                
                const pen = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.05, 0.005), this.getMaterial('#0000ff'));
                pen.position.set(hR.x, 0.48, hR.z);
                
                group.add(pad, pen);
                break;
            }
            case 'bierflasche': {
                const bottle = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.06, 0.025), this.getMaterial('#228b22'));
                bottle.position.set(hR.x, 0.46, hR.z);
                
                const neck = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.02, 0.012), this.getMaterial('#228b22'));
                neck.position.set(hR.x, 0.495, hR.z);
                
                const cap = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.006, 0.015), this.getMaterial('#ffd700'));
                cap.position.set(hR.x, 0.505, hR.z);
                
                group.add(bottle, neck, cap);
                break;
            }
            case 'knicklicht': {
                const stick = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.12, 0.012), this.getMaterial('#00ff00'));
                stick.position.set(hR.x, 0.48, hR.z);
                stick.rotation.z = Math.PI / 8;
                
                // Glow mesh
                const glowMat = new THREE.MeshBasicMaterial({ color: '#00ff00', transparent: true, opacity: 0.35, fog: false });
                const glow = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.13, 0.025), glowMat);
                glow.position.set(hR.x, 0.48, hR.z);
                glow.rotation.z = Math.PI / 8;
                
                group.add(stick, glow);
                break;
            }
            case 'brotzeitdose': {
                const box = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.05), this.getMaterial('#a9a9a9'));
                box.position.set(hR.x, 0.44, hR.z + 0.02);
                group.add(box);
                break;
            }
            case 'regenschirm': {
                const rod = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.20, 0.008), this.getMaterial('#000000'));
                rod.position.set(hR.x, 0.42, hR.z);
                
                const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.03), this.getMaterial('#ff0000'));
                cloth.position.set(hR.x, 0.46, hR.z);
                
                const handle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.008), this.getMaterial('#8b4513'));
                handle.position.set(hR.x - 0.006, 0.31, hR.z);
                
                group.add(rod, cloth, handle);
                break;
            }
            case 'doener': {
                const wrap = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.02), this.getMaterial('#ffffff'));
                wrap.position.set(hR.x, 0.49, hR.z + 0.02);
                
                const bread = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.05, 0.022), this.getMaterial('#d2b48c'));
                bread.position.set(hR.x, 0.505, hR.z + 0.02);
                
                const salad = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.015, 0.015), this.getMaterial('#00ff00'));
                salad.position.set(hR.x, 0.525, hR.z + 0.02);
                
                group.add(wrap, bread, salad);
                break;
            }
            case 'schere': {
                const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.08, 0.01), this.getMaterial('#c0c0c0'));
                s1.position.set(hR.x, 0.48, hR.z);
                s1.rotation.z = Math.PI / 12;
                
                const s2 = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.08, 0.01), this.getMaterial('#c0c0c0'));
                s2.position.set(hR.x, 0.48, hR.z);
                s2.rotation.z = -Math.PI / 12;
                
                group.add(s1, s2);
                break;
            }
            case 'kinderwagen': {
                const pram = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.12), this.getMaterial('#000080'));
                pram.position.set(0.24, 0.11, 0.15); // stand next to character on ground
                
                const wheelMat = this.getMaterial('#a9a9a9');
                const w1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.01), wheelMat);
                w1.position.set(0.18, 0.025, 0.09);
                const w2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.01), wheelMat);
                w2.position.set(0.30, 0.025, 0.09);
                const w3 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.01), wheelMat);
                w3.position.set(0.18, 0.025, 0.21);
                const w4 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.01), wheelMat);
                w4.position.set(0.30, 0.025, 0.21);
                
                group.add(pram, w1, w2, w3, w4);
                break;
            }
            case 'zeitung': {
                const paper = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, 0.12), this.getMaterial('#d3d3d3'));
                paper.position.set(hL.x + 0.015, 0.55, hL.z + 0.02);
                paper.rotation.x = Math.PI / 6;
                paper.rotation.y = -Math.PI / 12;
                group.add(paper);
                break;
            }
            case 'kopfhoerer': {
                const arcMat = this.getMaterial('#111111');
                const band = new THREE.Mesh(new THREE.BoxGeometry(0.146, 0.015, 0.08), arcMat);
                band.position.set(0, 0.985, 0);
                
                const cupL = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.035), arcMat);
                cupL.position.set(-0.074, 0.91, 0);
                const cupR = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.035), arcMat);
                cupR.position.set(0.074, 0.91, 0);
                
                group.add(band, cupL, cupR);
                break;
            }
            case 'jutebeutel': {
                const bag = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.12, 0.09), this.getMaterial('#f5deb3'));
                bag.position.set(hL.x - 0.01, 0.40, hL.z);
                
                const bio = new THREE.Mesh(new THREE.BoxGeometry(0.017, 0.02, 0.05), this.getMaterial('#228b22'));
                bio.position.set(hL.x - 0.01, 0.40, hL.z);
                
                group.add(bag, bio);
                break;
            }
            case 'skateboard': {
                const deck = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.015, 0.20), this.getMaterial('#8b4513'));
                deck.position.set(0, 0.015, 0.20); // on ground
                
                const wMat = this.getMaterial('#111111');
                const w1 = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.015, 0.015), wMat);
                w1.position.set(-0.03, 0.007, 0.14);
                const w2 = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.007, 0.015), wMat);
                w2.position.set(0.03, 0.007, 0.14);
                const w3 = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.007, 0.015), wMat);
                w3.position.set(-0.03, 0.007, 0.26);
                const w4 = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.007, 0.015), wMat);
                w4.position.set(0.03, 0.007, 0.26);
                
                group.add(deck, w1, w2, w3, w4);
                break;
            }
            case 'rollator': {
                const frameMat = this.getMaterial('#808080');
                const seat = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 0.08), this.getMaterial('#111111'));
                seat.position.set(0, 0.35, 0.16);
                
                // Simple frame rods
                const rodL = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.4, 0.015), frameMat);
                rodL.position.set(-0.09, 0.22, 0.16);
                const rodR = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.4, 0.015), frameMat);
                rodR.position.set(0.09, 0.22, 0.16);
                
                // Small black wheels
                const wheelMat = this.getMaterial('#111111');
                const wh1 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.01), wheelMat);
                wh1.position.set(-0.09, 0.02, 0.20);
                const wh2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.01), wheelMat);
                wh2.position.set(0.09, 0.02, 0.20);
                
                group.add(seat, rodL, rodR, wh1, wh2);
                break;
            }
            case 'gitarre': {
                const bodyL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.04), this.getMaterial('#a52a2a'));
                bodyL.position.set(0, 0.60, -0.09); // slung on back
                bodyL.rotation.z = Math.PI / 6;
                
                const neckObj = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.15, 0.015), this.getMaterial('#8b4513'));
                neckObj.position.set(0.04, 0.70, -0.09);
                neckObj.rotation.z = Math.PI / 6;
                
                group.add(bodyL, neckObj);
                break;
            }
            case 'stadtplan': {
                const map = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.002), this.getMaterial('#e0ffff'));
                map.position.set(0, 0.52, 0.12);
                map.rotation.x = -Math.PI / 4;
                group.add(map);
                break;
            }
            case 'armbanduhr': {
                const watch = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.015), this.getMaterial('#a9a9a9'));
                watch.position.set(-0.145, 0.54, 0); // left wrist
                group.add(watch);
                break;
            }
            case 'energy': {
                const can = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.05, 0.025), this.getMaterial('#000080'));
                can.position.set(hR.x, 0.46, hR.z);
                
                const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.027, 0.01, 0.027), this.getMaterial('#00ff00'));
                stripe.position.set(hR.x, 0.46, hR.z);
                
                group.add(can, stripe);
                break;
            }
            case 'taschenlampe': {
                const torch = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.06), this.getMaterial('#000000'));
                torch.position.set(hR.x, 0.48, hR.z + 0.02);
                
                // transparent yellow beam
                const beamMat = new THREE.MeshBasicMaterial({ color: '#ffff00', transparent: true, opacity: 0.35, fog: false });
                const beam = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 8), beamMat);
                beam.position.set(hR.x, 0.48, hR.z + 0.15);
                beam.rotation.x = Math.PI / 2;
                
                group.add(torch, beam);
                break;
            }
            case 'boutiquetuete': {
                const bag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.03), this.getMaterial('#000000'));
                bag.position.set(hR.x, 0.38, hR.z);
                
                const logo = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.01, 0.032), this.getMaterial('#ffd700'));
                logo.position.set(hR.x, 0.38, hR.z);
                
                group.add(bag, logo);
                break;
            }
            case 'vogelfutter': {
                const cup = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), this.getMaterial('#8b4513'));
                cup.position.set(hR.x, 0.48, hR.z + 0.02);
                
                const grains = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.01, 0.035), this.getMaterial('#ffd700'));
                grains.position.set(hR.x, 0.50, hR.z + 0.02);
                
                group.add(cup, grains);
                break;
            }
            case 'fotoapparat': {
                const camera = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.04), this.getMaterial('#1a1a1a'));
                camera.position.set(0, 0.63, 0.072);
                
                const lens = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.015), this.getMaterial('#808080'));
                lens.position.set(0, 0.63, 0.092);
                
                group.add(camera, lens);
                break;
            }
            case 'jonglierbaelle': {
                // Three colored spheres floating in an arc above head
                const b1 = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), this.getMaterial('#ff0000'));
                b1.position.set(-0.06, 1.05, 0.04);
                const b2 = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), this.getMaterial('#ffff00'));
                b2.position.set(0.0, 1.10, 0.04);
                const b3 = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), this.getMaterial('#0000ff'));
                b3.position.set(0.06, 1.05, 0.04);
                
                group.add(b1, b2, b3);
                break;
            }
            case 'sticker': {
                const sheet = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.005), this.getMaterial('#ffffff'));
                sheet.position.set(hR.x, 0.49, hR.z + 0.02);
                
                const st = this.getMaterial('#ff00ff');
                const dot = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.007), st);
                dot.position.set(hR.x - 0.01, 0.49, hR.z + 0.021);
                
                group.add(sheet, dot);
                break;
            }
            case 'coffeetogo': {
                const cup = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.055, 0.032), this.getMaterial('#a52a2a'));
                cup.position.set(hR.x, 0.47, hR.z);
                const wrap = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.02, 0.034), this.getMaterial('#ffffff'));
                wrap.position.set(hR.x, 0.47, hR.z);
                group.add(cup, wrap);
                break;
            }
            case 'schulbuch': {
                const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.015), this.getMaterial('#ff0000'));
                b1.position.set(0, 0.54, 0.11);
                const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.015), this.getMaterial('#0000ff'));
                b2.position.set(0.01, 0.55, 0.125);
                
                group.add(b1, b2);
                break;
            }
            case 'bratwurst': {
                const roll = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.04), this.getMaterial('#deb887'));
                roll.position.set(hR.x, 0.49, hR.z + 0.02);
                
                const sausage = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.09), this.getMaterial('#654321'));
                sausage.position.set(hR.x, 0.49, hR.z + 0.02);
                
                group.add(roll, sausage);
                break;
            }
            case 'fahrkarte': {
                const ticket = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.005), this.getMaterial('#add8e6'));
                ticket.position.set(hR.x, 0.48, hR.z);
                group.add(ticket);
                break;
            }
            case 'werkzeugkoffer': {
                const box = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.06), this.getMaterial('#cc0000'));
                box.position.set(hR.x, 0.38, hR.z);
                group.add(box);
                break;
            }
            case 'lanyard': {
                const card = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.005), this.getMaterial('#c0c0c0'));
                card.position.set(0, 0.58, 0.072);
                
                const strapMat = this.getMaterial('#b91c1c');
                const strapL = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.18, 0.005), strapMat);
                strapL.position.set(-0.03, 0.68, 0.05);
                strapL.rotation.y = Math.PI / 4;
                const strapR = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.18, 0.005), strapMat);
                strapR.position.set(0.03, 0.68, 0.05);
                strapR.rotation.y = -Math.PI / 4;
                
                group.add(card, strapL, strapR);
                break;
            }
            case 'netzplan': {
                const sheet = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 0.002), this.getMaterial('#ffffff'));
                sheet.position.set(0, 0.52, 0.12);
                sheet.rotation.x = -Math.PI / 4;
                group.add(sheet);
                break;
            }
            case 'craftbeer': {
                const can = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.06, 0.035), this.getMaterial('#4682b4'));
                can.position.set(hR.x, 0.46, hR.z);
                
                const pattern = new THREE.Mesh(new THREE.BoxGeometry(0.037, 0.02, 0.037), this.getMaterial('#ff00ff'));
                pattern.position.set(hR.x, 0.46, hR.z);
                
                group.add(can, pattern);
                break;
            }
            case 'retrohandtasche': {
                const bag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.03), this.getMaterial('#ff6600'));
                bag.position.set(hL.x - 0.01, 0.38, hL.z);
                
                const strap = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.20, 0.005), this.getMaterial('#000000'));
                strap.position.set(hL.x - 0.01, 0.58, hL.z);
                
                group.add(bag, strap);
                break;
            }
            case 'thermoskanne': {
                const flask = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.03), this.getMaterial('#c0c0c0'));
                flask.position.set(hR.x, 0.46, hR.z);
                const cap = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.015, 0.032), this.getMaterial('#111111'));
                cap.position.set(hR.x, 0.50, hR.z);
                group.add(flask, cap);
                break;
            }
            case 'palette': {
                const board = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.01), this.getMaterial('#deb887'));
                board.position.set(hL.x, 0.46, hL.z + 0.02);
                
                const brush = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.08, 0.006), this.getMaterial('#808080'));
                brush.position.set(hR.x, 0.48, hR.z);
                
                group.add(board, brush);
                break;
            }
            case 'bgb': {
                const book = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.05), this.getMaterial('#b22222'));
                book.position.set(hR.x, 0.46, hR.z + 0.02);
                group.add(book);
                break;
            }
            case 'lederaktentasche': {
                const bag = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.04), this.getMaterial('#111111'));
                bag.position.set(hR.x, 0.38, hR.z);
                group.add(bag);
                break;
            }
            case 'klassenarbeit': {
                const stack = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.06), this.getMaterial('#ffffff'));
                stack.position.set(0, 0.52, 0.12);
                group.add(stack);
                break;
            }
            case 'brillenetui': {
                const caseObj = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.03), this.getMaterial('#8b4513'));
                caseObj.position.set(hR.x, 0.47, hR.z);
                group.add(caseObj);
                break;
            }
            case 'klemmbrett': {
                const board = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.01), this.getMaterial('#cd853f'));
                board.position.set(hR.x, 0.46, hR.z + 0.02);
                
                const paper = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.012), this.getMaterial('#ffffff'));
                paper.position.set(hR.x, 0.46, hR.z + 0.021);
                
                group.add(board, paper);
                break;
            }
            case 'motorradhandschuhe': {
                // thick black gloves covering hands
                const gL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), this.getMaterial('#000000'));
                gL.position.set(hL.x, 0.48, hL.z);
                const gR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), this.getMaterial('#000000'));
                gR.position.set(hR.x, 0.48, hR.z);
                group.add(gL, gR);
                break;
            }
            case 'wickeltasche': {
                const bag = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.08, 0.05), this.getMaterial('#f472b6'));
                bag.position.set(0, 0.60, 0.08); // worn diagonally
                group.add(bag);
                break;
            }
            case 'zollstock': {
                const ruler = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.08, 0.01), this.getMaterial('#ffd700'));
                ruler.position.set(0.07, 0.50, 0.05); // sticking out of pocket
                group.add(ruler);
                break;
            }
            case 'laptop': {
                const base = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.01, 0.08), this.getMaterial('#a9a9a9'));
                base.position.set(0, 0.52, 0.12);
                
                const screen = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.01), this.getMaterial('#000000'));
                screen.position.set(0, 0.56, 0.16);
                screen.rotation.x = -Math.PI / 6;
                
                group.add(base, screen);
                break;
            }
            case 'tablet': {
                const tab = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.01), this.getMaterial('#2f4f4f'));
                tab.position.set(hL.x, 0.48, hL.z + 0.04);
                tab.rotation.x = -Math.PI/6;
                
                const stylus = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.05, 0.005), this.getMaterial('#ffffff'));
                stylus.position.set(hR.x, 0.48, hR.z);
                
                group.add(tab, stylus);
                break;
            }
            case 'flachpaket': {
                const pkg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.40, 0.04), this.getMaterial('#deb887'));
                pkg.position.set(0, 0.55, 0.10);
                group.add(pkg);
                break;
            }
            case 'quellekatalog': {
                const book = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.04), this.getMaterial('#000080'));
                book.position.set(hR.x, 0.46, hR.z + 0.02);
                group.add(book);
                break;
            }
            case 'einweggrill': {
                const tray = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.03, 0.07), this.getMaterial('#c0c0c0'));
                tray.position.set(hR.x, 0.46, hR.z + 0.02);
                group.add(tray);
                break;
            }
            case 'schraubenschluessel': {
                const wrench = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.10, 0.015), this.getMaterial('#808080'));
                wrench.position.set(hR.x, 0.48, hR.z);
                group.add(wrench);
                break;
            }
            case 'fernglas': {
                const binocL = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.05, 0.025), this.getMaterial('#111111'));
                binocL.position.set(0.02, 0.63, 0.10);
                const binocR = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.05, 0.025), this.getMaterial('#111111'));
                binocR.position.set(-0.02, 0.63, 0.10);
                
                group.add(binocL, binocR);
                break;
            }
            case 'slr_camera': {
                const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.05), this.getMaterial('#111111'));
                body.position.set(0, 0.63, 0.072);
                
                const lens = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.05), this.getMaterial('#696969'));
                lens.position.set(0, 0.63, 0.112);
                
                group.add(body, lens);
                break;
            }
            case 'zwei_anhaenger': {
                const a1 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.005), this.getMaterial('#ff0000'));
                a1.position.set(hR.x, 0.48, hR.z + 0.02);
                const a2 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.005), this.getMaterial('#008000'));
                a2.position.set(hL.x, 0.48, hL.z + 0.02);
                group.add(a1, a2);
                break;
            }
            case 'taschenuhr': {
                const watch = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.01), this.getMaterial('#ffd700'));
                watch.position.set(hR.x, 0.46, hR.z);
                
                const chain = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.15, 0.005), this.getMaterial('#ffd700'));
                chain.position.set(hR.x, 0.54, hR.z);
                
                group.add(watch, chain);
                break;
            }
            case 'frakta': {
                const bag = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.10, 0.06), this.getMaterial('#003399'));
                bag.position.set(hR.x, 0.38, hR.z);
                
                const strapL = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.08, 0.01), this.getMaterial('#ffd700'));
                strapL.position.set(hR.x - 0.03, 0.43, hR.z);
                const strapR = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.08, 0.01), this.getMaterial('#ffd700'));
                strapR.position.set(hR.x + 0.03, 0.43, hR.z);
                
                group.add(bag, strapL, strapR);
                break;
            }
            case 'zwei_tickets': {
                const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.002), this.getMaterial('#ffa07a'));
                t1.position.set(hR.x - 0.01, 0.48, hR.z + 0.02);
                const t2 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.002), this.getMaterial('#90ee90'));
                t2.position.set(hR.x + 0.01, 0.48, hR.z + 0.02);
                group.add(t1, t2);
                break;
            }
            case 'tuerknauf': {
                const base = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.01), this.getMaterial('#8b4513'));
                base.position.set(hR.x, 0.46, hR.z + 0.02);
                const knob = new THREE.Mesh(new THREE.SphereGeometry(0.015, 4, 4), this.getMaterial('#daa520'));
                knob.position.set(hR.x, 0.46, hR.z + 0.03);
                group.add(base, knob);
                break;
            }
            case 'baecker_tuete': {
                const bag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.04), this.getMaterial('#d2b48c'));
                bag.position.set(hR.x, 0.44, hR.z + 0.02);
                
                const bMat = this.getMaterial('#8b4513');
                const bag1 = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.14, 0.015), bMat);
                bag1.position.set(hR.x - 0.01, 0.48, hR.z + 0.02);
                bag1.rotation.z = Math.PI / 12;
                const bag2 = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.14, 0.015), bMat);
                bag2.position.set(hR.x + 0.01, 0.48, hR.z + 0.02);
                bag2.rotation.z = -Math.PI / 12;
                
                group.add(bag, bag1, bag2);
                break;
            }
            case 'ereader': {
                const reader = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.008), this.getMaterial('#1a1a1a'));
                reader.position.set(hR.x, 0.48, hR.z + 0.03);
                
                const screen = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.010), this.getMaterial('#d3d3d3'));
                screen.position.set(hR.x, 0.48, hR.z + 0.031);
                
                group.add(reader, screen);
                break;
            }
            case 'regenschirm_holz': {
                const rod = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.20, 0.008), this.getMaterial('#000000'));
                rod.position.set(hR.x, 0.42, hR.z);
                
                const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.08, 0.028), this.getMaterial('#2e8b57'));
                cloth.position.set(hR.x, 0.46, hR.z);
                
                const handle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.008), this.getMaterial('#8b4513'));
                handle.position.set(hR.x - 0.006, 0.31, hR.z);
                
                group.add(rod, cloth, handle);
                break;
            }
            case 'kleeblatt_fahne': {
                const mast = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.30, 0.01), this.getMaterial('#808080'));
                mast.position.set(hR.x, 0.58, hR.z);
                
                const flag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.005), this.getMaterial('#008000'));
                flag.position.set(hR.x + 0.04, 0.68, hR.z);
                
                group.add(mast, flag);
                break;
            }
            case 'lebkuchenherz': {
                const heart = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.02), this.getMaterial('#8b4513'));
                heart.position.set(0, 0.63, 0.072);
                
                const blueStrap = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.16, 0.005), this.getMaterial('#0000ff'));
                blueStrap.position.set(-0.03, 0.70, 0.05);
                blueStrap.rotation.y = Math.PI / 4;
                const blueStrapR = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.16, 0.005), this.getMaterial('#0000ff'));
                blueStrapR.position.set(0.03, 0.70, 0.05);
                blueStrapR.rotation.y = -Math.PI / 4;
                
                group.add(heart, blueStrap, blueStrapR);
                break;
            }
            case 'schuhkarton': {
                const box = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.05), this.getMaterial('#ff4500'));
                box.position.set(hR.x, 0.44, hR.z + 0.02);
                const lid = new THREE.Mesh(new THREE.BoxGeometry(0.094, 0.01, 0.054), this.getMaterial('#ffffff'));
                lid.position.set(hR.x, 0.465, hR.z + 0.02);
                group.add(box, lid);
                break;
            }
            case 'navigesp': {
                const dev = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.01), this.getMaterial('#000000'));
                dev.position.set(hR.x, 0.49, hR.z + 0.04);
                dev.rotation.x = -Math.PI / 6;
                
                const screen = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.012), this.getMaterial('#008000'));
                screen.position.set(hR.x, 0.49, hR.z + 0.041);
                screen.rotation.x = -Math.PI / 6;
                
                group.add(dev, screen);
                break;
            }
            case 'bierkrug': {
                const mug = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.04), this.getMaterial('#ffd700'));
                mug.position.set(hR.x, 0.46, hR.z + 0.02);
                
                const foam = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.01, 0.042), this.getMaterial('#ffffff'));
                foam.position.set(hR.x, 0.495, hR.z + 0.02);
                
                group.add(mug, foam);
                break;
            }
            case 'rosenstrauss': {
                const wrap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.05), this.getMaterial('#ffffff'));
                wrap.position.set(hR.x, 0.48, hR.z + 0.02);
                
                const flower = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.04), this.getMaterial('#dc2626'));
                flower.position.set(hR.x, 0.52, hR.z + 0.02);
                
                group.add(wrap, flower);
                break;
            }
            case 'kleeblatt_pin': {
                // Tiny pin on breast (Handled in 9. Facial details & Accessories)
                const pin = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.005), this.getMaterial('#00ff00'));
                pin.position.set(0.04, 0.65, 0.071);
                group.add(pin);
                break;
            }
            case 'reisefuehrer': {
                const book = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.012), this.getMaterial('#4169e1'));
                book.position.set(hR.x, 0.48, hR.z + 0.03);
                
                const star = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, 0.015), this.getMaterial('#ffd700'));
                star.position.set(hR.x, 0.48, hR.z + 0.038);
                
                group.add(book, star);
                break;
            }
            case 'konzertticket': {
                const ticket = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.005), this.getMaterial('#daa520'));
                ticket.position.set(hR.x, 0.48, hR.z);
                group.add(ticket);
                break;
            }
            case 'angelrute': {
                const rod = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.35, 0.01), this.getMaterial('#808080'));
                rod.position.set(hR.x, 0.60, hR.z + 0.05);
                rod.rotation.x = Math.PI / 6;
                group.add(rod);
                break;
            }
            case 'schreibmappe': {
                const folder = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.015), this.getMaterial('#111111'));
                folder.position.set(hR.x, 0.48, hR.z + 0.03);
                group.add(folder);
                break;
            }
            case 'action_cam': {
                const stick = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.25, 0.008), this.getMaterial('#000000'));
                stick.position.set(hR.x, 0.55, hR.z + 0.05);
                stick.rotation.x = Math.PI / 4;
                
                const cam = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.025), this.getMaterial('#000000'));
                cam.position.set(hR.x, 0.64, hR.z + 0.14);
                
                group.add(stick, cam);
                break;
            }
            case 'stethoskop': {
                // Handled in the Y neck area
                const scope = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.005), this.getMaterial('#808080'));
                scope.position.set(0, 0.70, 0.072);
                
                const strapMat = this.getMaterial('#111111');
                const strapL = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.10, 0.005), strapMat);
                strapL.position.set(-0.03, 0.74, 0.05);
                const strapR = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.10, 0.005), strapMat);
                strapR.position.set(0.03, 0.74, 0.05);
                
                group.add(scope, strapL, strapR);
                break;
            }
            case 'patientenakte': {
                const board = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.01), this.getMaterial('#20b2aa'));
                board.position.set(hR.x, 0.46, hR.z + 0.02);
                
                const paper = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.012), this.getMaterial('#ffffff'));
                paper.position.set(hR.x, 0.46, hR.z + 0.021);
                
                group.add(board, paper);
                break;
            }
            case 'kruecke': {
                const stick = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.4, 0.02), this.getMaterial('#808080'));
                stick.position.set(hR.x, 0.20, hR.z);
                
                const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.02), this.getMaterial('#808080'));
                arm.position.set(hR.x, 0.40, hR.z);
                
                group.add(stick, arm);
                break;
            }
            case 'blumen_obst': {
                const flowers = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), this.getMaterial('#ff00ff'));
                flowers.position.set(hL.x, 0.49, hL.z + 0.02);
                
                const basket = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.05), this.getMaterial('#8b4513'));
                basket.position.set(hR.x, 0.44, hR.z + 0.02);
                
                group.add(flowers, basket);
                break;
            }
            case 'schluessel_etui': {
                const etui = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.02), this.getMaterial('#8b4513'));
                etui.position.set(hR.x, 0.46, hR.z);
                
                const key = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.02, 0.005), this.getMaterial('#808080'));
                key.position.set(hR.x, 0.43, hR.z);
                
                group.add(etui, key);
                break;
            }
            case 'multimeter': {
                const meter = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.02), this.getMaterial('#ffd700'));
                meter.position.set(hR.x, 0.46, hR.z);
                
                const screen = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.022), this.getMaterial('#000000'));
                screen.position.set(hR.x, 0.475, hR.z);
                
                group.add(meter, screen);
                break;
            }
            case 'geodreieck': {
                const tri = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.005), this.getMaterial('#ffff00'));
                tri.position.set(hR.x, 0.48, hR.z);
                group.add(tri);
                break;
            }
            case 'nackenhoernchen': {
                const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.04, 0.09), this.getMaterial('#4169e1'));
                pillow.position.set(0, 0.81, 0.01);
                group.add(pillow);
                break;
            }
        }

        // Scale item meshes around their collective center by 2.0
        if (itemTempGroup.children.length > 0) {
            const box = new THREE.Box3();
            itemTempGroup.children.forEach(child => {
                child.updateMatrix();
                child.geometry.computeBoundingBox();
                const childBox = child.geometry.boundingBox.clone();
                childBox.applyMatrix4(child.matrix);
                box.union(childBox);
            });

            const center = new THREE.Vector3();
            box.getCenter(center);

            // Scale each child relative to this center
            itemTempGroup.children.forEach(child => {
                // Shift position relative to center, scale position, shift back
                child.position.sub(center).multiplyScalar(2.0).add(center);
                // Double the scale
                child.scale.multiplyScalar(2.0);
            });

            // Move all processed children to the main passenger group
            while (itemTempGroup.children.length > 0) {
                mainGroup.add(itemTempGroup.children[0]);
            }
        }
    }
}
