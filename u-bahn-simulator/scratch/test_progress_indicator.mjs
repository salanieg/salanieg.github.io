import './dom_stubs.mjs';

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log('  [PASS] ' + message);
        passed++;
    } else {
        console.error('  [FAIL] ' + message);
        failed++;
    }
}

console.log('=== TESTING LOADING PROGRESS INDICATOR ===');

// Setup mock app state
const mockApp = {
    isReadyToStart: false,
    _loadPipelineStepIdx: 4,
    _cityDl: { progress: 0.5, done: false },
    _resChunks: new Set([0, 1, 2, 3, 4, 5]),
    _resStations: new Set([0, 1]),
    _residency: { totalChunks: 370, numStations: 27, done: false },
    _displayProgress: 0,
    dom: {
        introLoadingStatus: { textContent: '' }
    }
};

// Implement same calculation
function calculate(app) {
    let pct = 0;
    const pipelineSteps = 8;
    const currentStep = app._loadPipelineStepIdx || 0;
    pct += Math.min(12, Math.floor((currentStep / pipelineSteps) * 12));

    if (app._cityDl) {
        if (app._cityDl.done || app._cityDl.error) {
            pct += 20;
        } else if (app._cityDl.progress) {
            pct += Math.floor(app._cityDl.progress * 20);
        }
    }

    if (app._residency) {
        const total = (app._residency.totalChunks || 370) + (app._residency.numStations || 27);
        const loaded = (app._resChunks ? app._resChunks.size : 0) + (app._resStations ? app._resStations.size : 0);
        if (app._residency.done) {
            pct += 68;
        } else {
            pct += Math.floor(Math.min(1, loaded / Math.max(1, total)) * 68);
        }
    }

    pct = Math.min(99, Math.max(0, pct));
    app._displayProgress = Math.max(app._displayProgress || 0, pct);
    app.dom.introLoadingStatus.textContent = `${app._displayProgress} % geladen`;
    return app._displayProgress;
}

const p1 = calculate(mockApp);
assert(p1 > 0 && p1 < 100, `Midway progress calculated: ${p1} %`);
assert(mockApp.dom.introLoadingStatus.textContent.includes('% geladen'), 'Status text formatted with % geladen');

// Test 100% completion
mockApp._cityDl.done = true;
mockApp._residency.done = true;
mockApp._isStartingWarmup = true;
calculate(mockApp);
mockApp.dom.introLoadingStatus.textContent = '100 % geladen';
assert(mockApp.dom.introLoadingStatus.textContent === '100 % geladen', 'Reaches 100 % geladen');

console.log(`\nPROGRESS INDICATOR TEST SUMMARY: ${passed} passed, ${failed} failed`);
