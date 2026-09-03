import * as THREE from 'three';

/**
 * SpaceIntro manages the instant "Cockpit in the Cosmos" environment.
 * Renders an ultra-fast, perfectly parallel starfield using LineSegments:
 * Each star is a line segment parallel to the Z axis (the train's exact forward driving direction).
 * As the train moves forward into +Z, stars drift smoothly past the cockpit from +Z towards -Z.
 * During warp, the lines stretch into radiant hyperspace streaks strictly parallel to the driving direction.
 */
export class SpaceIntro {
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;
        this.group = new THREE.Group();
        this.group.name = 'spaceIntroGroup';
        this.scene.add(this.group);

        this.isActive = true;
        this.isWarping = false;
        this.warpProgress = 0;
        this.warpDuration = 1.0; // seconds
        this.baseSpeed = 6.0;    // gentle forward drift (m/s)
        this.currentSpeed = this.baseSpeed;
        this.onWarpComplete = null;

        this.starCount = 2800;
        this.starPositions = null;
        this.starBaseZ = null;
        this.starLines = null;

        this._initEnvironment();
        this._initStarfield();
    }

    _initEnvironment() {
        // Deep cosmic void background
        this.spaceColor = new THREE.Color('#010208');
        this.scene.background = this.spaceColor;

        // Cool cosmic ambient & soft directional rim
        this.ambientLight = new THREE.AmbientLight(0x23293a, 1.4);
        this.group.add(this.ambientLight);

        this.rimLight = new THREE.DirectionalLight(0x7da4d9, 1.6);
        this.rimLight.position.set(30, 40, 50);
        this.group.add(this.rimLight);
    }

    _initStarfield() {
        const count = this.starCount;
        const geom = new THREE.BufferGeometry();
        // 2 vertices per star line segment -> count * 2 * 3 = count * 6
        const positions = new Float32Array(count * 6);
        const colors = new Float32Array(count * 6);
        this.starBaseZ = new Float32Array(count);

        const colorPalette = [
            [1.0, 1.0, 1.0],       // brilliant white
            [0.85, 0.93, 1.0],     // diamond blue
            [0.6, 0.85, 1.0],      // celestial cyan
            [1.0, 0.88, 0.65],     // warm amber
            [0.88, 0.75, 1.0]      // violet star
        ];

        let created = 0;
        while (created < count) {
            // Distribute around the train path (train is from Z = 0 to Z = -77, width 3m, height 3.5m)
            const angle = Math.random() * Math.PI * 2;
            const dist = 3.5 + Math.pow(Math.random(), 1.6) * 160;
            const x = Math.cos(angle) * dist;
            const y = (Math.random() - 0.45) * 120;
            const z = (Math.random() - 0.35) * 400; // Z from -140 to +260

            // Skip stars inside the train interior volume
            if (Math.abs(x) < 2.0 && y > 0 && y < 3.8 && z < 2 && z > -80) {
                continue;
            }

            const i6 = created * 6;
            const col = colorPalette[Math.floor(Math.random() * colorPalette.length)];

            // Initial pinpoint length (0.4 m)
            const initialStreak = 0.4;

            // Vertex A (leading edge): (x, y, z)
            positions[i6] = x;
            positions[i6 + 1] = y;
            positions[i6 + 2] = z;

            // Vertex B (trailing edge): (x, y, z + streak)
            positions[i6 + 3] = x;
            positions[i6 + 4] = y;
            positions[i6 + 5] = z + initialStreak;

            // Both vertices have the exact same X and Y -> 100% strictly parallel to Z!
            colors[i6] = col[0];
            colors[i6 + 1] = col[1];
            colors[i6 + 2] = col[2];

            colors[i6 + 3] = col[0] * 0.7; // slight fade towards tail
            colors[i6 + 4] = col[1] * 0.7;
            colors[i6 + 5] = col[2] * 0.7;

            this.starBaseZ[created] = z;
            created++;
        }

        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        this.starPositions = positions;

        this.starMaterial = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.starLines = new THREE.LineSegments(geom, this.starMaterial);
        this.group.add(this.starLines);
    }

    update(dt) {
        if (!this.isActive || !this.starPositions) return;

        let streakLen = 0.4;

        // Handle warp acceleration
        if (this.isWarping) {
            this.warpProgress += dt / this.warpDuration;
            const t = Math.min(1, this.warpProgress);
            // Exponential speed burst up to 550 m/s
            this.currentSpeed = this.baseSpeed + Math.pow(t, 2.2) * 550;
            // Lines stretch into radiant forward/backward streaks
            streakLen = 0.4 + Math.pow(t, 1.8) * 55.0;

            if (t >= 1 && this.onWarpComplete) {
                const cb = this.onWarpComplete;
                this.onWarpComplete = null;
                cb();
            }
        }

        const positions = this.starPositions;
        const baseZ = this.starBaseZ;
        const speed = this.currentSpeed;
        const count = this.starCount;

        // Drift stars forward relative to cab (moving in -Z direction)
        for (let i = 0; i < count; i++) {
            let z = baseZ[i] - speed * dt;

            // When a star passes far behind the train, recycle it far ahead
            if (z < -140) {
                z += 400;
            }
            baseZ[i] = z;

            const i6 = i * 6;
            // Vertex A (leading front point)
            positions[i6 + 2] = z;
            // Vertex B (trailing tail point) - 100% parallel to Z axis!
            positions[i6 + 5] = z + streakLen;
        }

        this.starLines.geometry.attributes.position.needsUpdate = true;
    }

    /**
     * Triggers the warp hyperspace jump and calls onComplete when finished.
     */
    triggerWarp(onComplete) {
        if (this.isWarping) return;
        this.isWarping = true;
        this.warpProgress = 0;
        this.onWarpComplete = onComplete;
    }

    /**
     * Cleanly dismantles the space intro from the scene.
     */
    dispose() {
        this.isActive = false;
        if (this.starLines) {
            this.starLines.geometry.dispose();
            this.starMaterial.dispose();
        }
        if (this.group.parent) {
            this.group.parent.remove(this.group);
        }
    }
}
