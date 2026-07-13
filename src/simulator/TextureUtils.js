import * as THREE from 'three';

// Tags a CanvasTexture as sRGB WITHOUT changing how it looks on screen.
//
// Untagged canvas textures are sampled as linear data. Adding the sRGB tag
// alone would make the sampler apply the sRGB decode and the texture would
// suddenly render considerably darker than its hand-tuned look. Re-encoding
// every pixel with the sRGB OETF first cancels that decode out exactly, so
// the look is preserved while the color pipeline becomes consistent with the
// textures that carried the tag from the start.
export function tagCanvasTextureSRGBKeepLook(texture) {
    const canvas = texture.image;
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
        for (let c = 0; c < 3; c++) {
            const v = d[i + c] / 255;
            const e = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
            d[i + c] = Math.round(e * 255);
        }
    }
    ctx.putImageData(img, 0, 0);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
}
