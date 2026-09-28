import * as THREE from './../node_modules/three/build/three.module.js';

// Setup mock canvas
globalThis.document = {
    createElement(tag) {
        if (tag === 'canvas') {
            return {
                width: 1024,
                height: 512,
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
        return {};
    }
};

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 16/9, 0.1, 1000);

console.log("Testing full scene creation...");
// Let's test creating the helicopter and helipad materials and meshes
try {
    const canvas = document.createElement("canvas");
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.MeshStandardMaterial({
        map: tex,
        emissive: 0xffffff,
        emissiveMap: tex,
        emissiveIntensity: 0.95
    });
    console.log("Material created successfully:", mat.type);

    const geo = new THREE.BoxGeometry(2, 2, 2);
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);

    // Test Spotlight
    const spot = new THREE.SpotLight(0xfffaed, 0, 120, Math.PI / 6, 0.35, 1.2);
    spot.target.position.set(0, -10, 35);
    scene.add(spot);
    scene.add(spot.target);
    console.log("SpotLight created successfully:", spot.type);

    console.log("All three scene test passed!");
} catch (e) {
    console.error("CRASH:", e);
}
