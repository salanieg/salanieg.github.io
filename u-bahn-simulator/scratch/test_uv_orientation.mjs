import './dom_stubs.mjs';
import assert from 'assert';
import * as THREE from 'three';

function testUVOrientation() {
    const N = 24;
    const signLen = 6.0;
    const halfL = signLen / 2;
    const halfH = 0.32;

    function getUVSamples(sideSign) {
        // Samples along curve from i = 0 (z = -halfL) to i = N (z = +halfL)
        // With corrected formula:
        // sideSign > 0: u = 1 - t
        // sideSign < 0: u = t
        const samples = [];
        for (let i = 0; i <= N; i++) {
            const t = i / N;
            const z = -halfL + t * signLen;
            const u = (sideSign > 0) ? (1 - t) : t;
            samples.push({ z, u });
        }
        return samples;
    }

    // 1. Check Track 1 (+X side):
    // Viewer stands at (+10, 0, 0) and looks towards (0, 0, 0) in direction -X.
    // In viewer camera space:
    // camera.lookAt(0, 0, 0), camera.up is (0, 1, 0)
    // viewer's right direction is camera.right = -Z.
    // viewer's left direction is camera.left = +Z.
    // As viewer scans from LEFT to RIGHT:
    // Z goes from +halfL (left) to -halfL (right).
    const samplesR = getUVSamples(1);
    // Find sample at leftmost (highest Z):
    const leftSampleR = samplesR.find(s => Math.abs(s.z - halfL) < 0.001);
    // Find sample at rightmost (lowest Z):
    const rightSampleR = samplesR.find(s => Math.abs(s.z - (-halfL)) < 0.001);

    console.log(`Track 1 (+X side): Left (Z=+${halfL}) has u=${leftSampleR.u}, Right (Z=-${halfL}) has u=${rightSampleR.u}`);
    assert.strictEqual(leftSampleR.u, 0, 'On +X branch, left side (Z=+halfL) must be u=0 (start of text)');
    assert.strictEqual(rightSampleR.u, 1, 'On +X branch, right side (Z=-halfL) must be u=1 (end of text)');

    // 2. Check Track 2 (-X side):
    // Viewer stands at (-10, 0, 0) and looks towards (0, 0, 0) in direction +X.
    // In viewer camera space:
    // camera.lookAt(0, 0, 0), camera.up is (0, 1, 0)
    // viewer's right direction is camera.right = +Z.
    // viewer's left direction is camera.left = -Z.
    // As viewer scans from LEFT to RIGHT:
    // Z goes from -halfL (left) to +halfL (right).
    const samplesL = getUVSamples(-1);
    // Find sample at leftmost (lowest Z):
    const leftSampleL = samplesL.find(s => Math.abs(s.z - (-halfL)) < 0.001);
    // Find sample at rightmost (highest Z):
    const rightSampleL = samplesL.find(s => Math.abs(s.z - halfL) < 0.001);

    console.log(`Track 2 (-X side): Left (Z=-${halfL}) has u=${leftSampleL.u}, Right (Z=+${halfL}) has u=${rightSampleL.u}`);
    assert.strictEqual(leftSampleL.u, 0, 'On -X branch, left side (Z=-halfL) must be u=0 (start of text)');
    assert.strictEqual(rightSampleL.u, 1, 'On -X branch, right side (Z=+halfL) must be u=1 (end of text)');

    console.log('ALL UV ORIENTATION TESTS PASSED: Text reads correctly from left to right on both branches!');
}

testUVOrientation();
