// Simulate initThreeWorld() execution to catch any runtime exceptions
import * as THREE from './../node_modules/three/build/three.module.js';

// Setup mock browser globals
globalThis.window = {
    innerWidth: 1920,
    innerHeight: 1080,
    devicePixelRatio: 1,
    addEventListener() {},
    removeEventListener() {},
    TERRAIN_HEIGHTS_256: new Float32Array(256 * 256).fill(0.34)
};

globalThis.document = {
    body: {
        appendChild() {},
        removeChild() {}
    },
    getElementById(id) {
        return {
            style: {},
            classList: { add() {}, remove() {}, contains() { return false; } },
            addEventListener() {},
            textContent: ''
        };
    },
    createElement(tag) {
        return {
            width: 1024,
            height: 512,
            style: {},
            appendChild() {},
            getContext() {
                return {
                    fillStyle: '',
                    strokeStyle: '',
                    lineWidth: 1,
                    font: '',
                    textAlign: '',
                    textBaseline: '',
                    fillRect() {},
                    strokeRect() {},
                    clearRect() {},
                    beginPath() {},
                    moveTo() {},
                    lineTo() {},
                    arc() {},
                    fill() {},
                    stroke() {},
                    save() {},
                    restore() {},
                    translate() {},
                    rotate() {},
                    scale() {},
                    fillText() {},
                    measureText() { return { width: 100 }; },
                    createLinearGradient() { return { addColorStop() {} }; },
                    createRadialGradient() { return { addColorStop() {} }; },
                    setLineDash() {},
                    clip() {}
                };
            }
        };
    }
};

globalThis.performance = { now: () => Date.now() };

console.log("Mock environment ready. Testing imports from app.js...");
