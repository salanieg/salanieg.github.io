// Minimale DOM-Stubs, damit Canvas-Textur-Code (document.createElement('canvas'),
// 2D-Kontexte, ImageData) headless unter Node läuft. Wird von den verify_*/
// sweep_*/census-Skripten importiert; identisch zur bewährten Stub-Schicht,
// die vorher in train_census.mjs inline stand.
function makeCtxProxy() {
    const gradient = { addColorStop() {} };
    const cache = new Map();
    return new Proxy({}, {
        get(t, prop) {
            if (prop === 'canvas') return null;
            if (prop === 'measureText') return () => ({ width: 50 });
            if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
            if (prop === 'createPattern') return () => ({});
            if (prop === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(4 * Math.max(1, w * h)) });
            if (prop === 'createImageData') return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(4 * Math.max(1, w * h)) });
            if (!cache.has(prop)) cache.set(prop, () => {});
            return cache.get(prop);
        },
        set() { return true; }
    });
}

// Eigene Klasse, damit `x instanceof HTMLCanvasElement`-Checks im
// Produktionscode (z. B. StationModel._makeCylinderPillarMat) headless
// funktionieren.
class HTMLCanvasElementStub {
    constructor() {
        this.width = 0;
        this.height = 0;
        this.style = {};
    }
    getContext() { return makeCtxProxy(); }
    toDataURL() { return ''; }
    // three.js' ImageLoader hängt Listener an das Element (auch <img>-Stubs
    // laufen über diese Klasse); headless lädt nie etwas -> No-ops genügen.
    addEventListener() {}
    removeEventListener() {}
    setAttribute() {}
}

function makeCanvas() {
    return new HTMLCanvasElementStub();
}

export function installDomStubs() {
    if (globalThis.document) return; // echter Browser oder schon installiert
    globalThis.HTMLCanvasElement = HTMLCanvasElementStub;
    globalThis.document = {
        createElement: (tag) => makeCanvas(),
        createElementNS: () => makeCanvas(),
        fonts: { add() {} },
        body: { classList: { contains: () => false } }
    };
    globalThis.window = { devicePixelRatio: 1 };
    globalThis.self = globalThis;
}

installDomStubs();
