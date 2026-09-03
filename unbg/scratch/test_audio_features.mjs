// test_audio_features.mjs
import assert from 'node:assert';
import { Simulation } from '../src/simulator/Simulation.js';

// Web Audio API Mock for headless testing
class AudioParamMock {
    constructor(val = 0) {
        this.value = val;
    }
    setValueAtTime(v, t) { this.value = v; }
    setTargetAtTime(v, t, tc) { this.value = v; }
    linearRampToValueAtTime(v, t) { this.value = v; }
    exponentialRampToValueAtTime(v, t) { this.value = v; }
}

class AudioNodeMock {
    constructor() {
        this.connectedTo = [];
    }
    connect(node) {
        this.connectedTo.push(node);
        return node;
    }
    disconnect() {
        this.connectedTo = [];
    }
}

class GainNodeMock extends AudioNodeMock {
    constructor(val = 1) {
        super();
        this.gain = new AudioParamMock(val);
    }
}

class BiquadFilterNodeMock extends AudioNodeMock {
    constructor() {
        super();
        this.type = 'lowpass';
        this.frequency = new AudioParamMock(350);
        this.Q = new AudioParamMock(1);
        this.gain = new AudioParamMock(0);
    }
}

class DynamicsCompressorNodeMock extends AudioNodeMock {
    constructor() {
        super();
        this.threshold = new AudioParamMock(-24);
        this.knee = new AudioParamMock(30);
        this.ratio = new AudioParamMock(12);
        this.attack = new AudioParamMock(0.003);
        this.release = new AudioParamMock(0.25);
    }
}

class OscillatorNodeMock extends AudioNodeMock {
    constructor() {
        super();
        this.type = 'sine';
        this.frequency = new AudioParamMock(440);
        this.detune = new AudioParamMock(0);
        this.started = false;
        this.stopped = false;
    }
    start(t) { this.started = true; }
    stop(t) { this.stopped = true; }
}

class BufferSourceNodeMock extends AudioNodeMock {
    constructor() {
        super();
        this.buffer = null;
        this.loop = false;
        this.started = false;
        this.stopped = false;
    }
    start(t) { this.started = true; }
    stop(t) { this.stopped = true; }
}

class AudioBufferMock {
    constructor(channels, length, sampleRate) {
        this.numberOfChannels = channels;
        this.length = length;
        this.sampleRate = sampleRate;
        this._data = new Float32Array(length);
    }
    getChannelData(c) {
        return this._data;
    }
}

class AudioContextMock {
    constructor() {
        this.state = 'running';
        this.currentTime = 0;
        this.sampleRate = 44100;
        this.destination = new AudioNodeMock();
    }
    resume() { this.state = 'running'; }
    createGain() { return new GainNodeMock(); }
    createBiquadFilter() { return new BiquadFilterNodeMock(); }
    createDynamicsCompressor() { return new DynamicsCompressorNodeMock(); }
    createOscillator() { return new OscillatorNodeMock(); }
    createBufferSource() { return new BufferSourceNodeMock(); }
    createBuffer(c, l, s) { return new AudioBufferMock(c, l, s); }
    createConvolver() { return new AudioNodeMock(); }
}

globalThis.window = globalThis;
globalThis.AudioContext = AudioContextMock;
globalThis.webkitAudioContext = AudioContextMock;
globalThis.localStorage = {
    getItem: () => '0.8',
    setItem: () => {}
};

// Import AudioManager
const { AudioManager } = await import('../src/audio/AudioManager.js');

console.log("=== 1. TESTING AUDIOMANAGER INITIALIZATION & MOBILE PROCESSING ===");
const audio = new AudioManager();
audio.init();

assert.ok(audio.initialized, "AudioManager should be initialized");
assert.ok(audio.phoneHighpass, "Phone highpass filter created");
assert.strictEqual(audio.phoneHighpass.type, 'highpass', "Phone highpass filter type is highpass");
assert.strictEqual(audio.phoneHighpass.frequency.value, 95, "Phone highpass cut frequency is 95 Hz");

assert.ok(audio.phoneWarmth, "Phone warmth filter created");
assert.strictEqual(audio.phoneWarmth.type, 'peaking', "Phone warmth is peaking EQ");
assert.strictEqual(audio.phoneWarmth.frequency.value, 320, "Phone warmth frequency is 320 Hz");

assert.ok(audio.phonePresence, "Phone presence filter created");
assert.strictEqual(audio.phonePresence.type, 'peaking', "Phone presence is peaking EQ");
assert.strictEqual(audio.phonePresence.frequency.value, 2400, "Phone presence frequency is 2400 Hz");

assert.ok(audio.phoneCompressor, "Phone dynamics compressor created");
assert.strictEqual(audio.phoneCompressor.threshold.value, -14, "Phone compressor threshold is -14 dB");
console.log("  [PASS] Mobile phone speaker optimization chain (Highpass 95Hz, Warmth 320Hz, Presence 2400Hz, Compressor) verified");

console.log("\n=== 2. TESTING TRAIN & STATION AMBIANCE SYNTHS ===");
assert.ok(audio.trainAmbianceGain, "trainAmbianceGain exists");
assert.ok(audio.stationAmbianceGain, "stationAmbianceGain exists");
assert.ok(audio.trainAirSource.started, "Train airflow loop is running");
assert.ok(audio.stationNoiseSource.started, "Station noise loop is running");
assert.strictEqual(audio.debugMix.ambiance, 1, "Ambiance channel present in debugMix");

// Test update in tunnel (far away from station)
audio.update(10, 0.5, 0, 0.016, true, 300, false);
assert.strictEqual(audio.stationAmbianceGain.gain.value, 0.012, "Tunnel station ambiance is subtle baseline (0.012)");
assert.strictEqual(audio.trainAmbianceGain.gain.value, 0.038, "Inside train ambiance is steady (0.038)");

// Test update at station
audio.update(0, 0, 2.0, 0.016, true, 20, false);
assert.strictEqual(audio.stationAmbianceGain.gain.value, 0.034, "Station ambiance is full presence at station (0.034)");
assert.strictEqual(audio.trainAmbianceGain.gain.value, 0.038, "Inside train ambiance remains constant at station");

// Test platform view
audio.update(0, 0, 0, 0.016, false, 500, true);
assert.strictEqual(audio.stationAmbianceGain.gain.value, 0.034, "Platform view has full station presence");
assert.strictEqual(audio.trainAmbianceGain.gain.value, 0.022, "Exterior train ambiance is slightly softer (0.022)");
console.log("  [PASS] Train and station ambiance levels and transitions verified");

console.log("\n=== 3. TESTING EMERGENCY BRAKE ALARM (6x BIMMELN) ===");
let bimmelCount = 0;
const origPlayBimmel = audio._playBimmelStrike.bind(audio);
audio._playBimmelStrike = (time) => {
    bimmelCount++;
    origPlayBimmel(time);
};
audio.playEmergencyBrakeAlarm();
assert.strictEqual(bimmelCount, 6, "playEmergencyBrakeAlarm must trigger exactly 6 bimmel strikes");
console.log("  [PASS] 6x rapid bimmeln alarm verified");

console.log("\n=== 4. TESTING EMERGENCY BRAKE RELEASE (2-SECOND CONTINUOUS PIEPEN) ===");
let releaseBeepCreated = false;
const origCreateOsc = audio.ctx.createOscillator.bind(audio.ctx);
audio.ctx.createOscillator = () => {
    const osc = origCreateOsc();
    const origSetVal = osc.frequency.setValueAtTime.bind(osc.frequency);
    osc.frequency.setValueAtTime = (val, t) => {
        if (Math.abs(val - 1174.66) < 1) releaseBeepCreated = true;
        origSetVal(val, t);
    };
    return osc;
};
audio.playEmergencyBrakeRelease();
assert.ok(releaseBeepCreated, "Emergency brake release creates 1175 Hz continuous tone");
console.log("  [PASS] 2-second continuous piepen release sound verified");

console.log("\n=== 5. TESTING SIMULATION EMERGENCY BRAKE HOOK ===");
const sim = new Simulation();
let hookCalls = [];
sim.onEmergencyBrakeChange = (isActive) => {
    hookCalls.push(isActive);
};

assert.strictEqual(sim.emergencyBrake, false, "Initial emergency brake is false");

// Press spacebar (activate)
sim.triggerEmergencyBrake();
assert.strictEqual(sim.emergencyBrake, true, "Emergency brake is true after 1st toggle");
assert.strictEqual(sim.throttle, -1, "Throttle forced to -1 on emergency brake");
assert.deepStrictEqual(hookCalls, [true], "onEmergencyBrakeChange called with true");

// Press spacebar again (release)
sim.triggerEmergencyBrake();
assert.strictEqual(sim.emergencyBrake, false, "Emergency brake is false after 2nd toggle");
assert.deepStrictEqual(hookCalls, [true, false], "onEmergencyBrakeChange called with false on release");

console.log("  [PASS] Simulation emergency brake toggle and onEmergencyBrakeChange verified");

console.log("\n=== 6. TESTING REALISTIC MULTI-LAYER FOOTSTEPS ===");
let stepOscs = 0;
let stepFilters = 0;
const origOsc = audio.ctx.createOscillator.bind(audio.ctx);
const origFilter = audio.ctx.createBiquadFilter.bind(audio.ctx);

audio.ctx.createOscillator = () => {
    stepOscs++;
    return origOsc();
};
audio.ctx.createBiquadFilter = () => {
    stepFilters++;
    return origFilter();
};

const initialIdx = audio._footstepStepIdx;

// Test Unified Footstep
stepOscs = 0;
stepFilters = 0;
audio.playFootstep(0.24);
assert.strictEqual(audio._footstepStepIdx, initialIdx + 1, "Footstep alternating index advances");
assert.ok(stepOscs >= 2, "Unified footstep generates heel transient + body thump");
assert.ok(stepFilters >= 2, "Unified footstep generates bandpass filters for click & scuff");

// Test second step (advances foot index)
stepOscs = 0;
stepFilters = 0;
audio.playFootstep(0.24);
assert.strictEqual(audio._footstepStepIdx, initialIdx + 2, "Footstep alternating index advances again (left/right foot variation)");
assert.ok(stepOscs >= 2, "Second step generates heel transient + body thump");
assert.ok(stepFilters >= 2, "Second step generates click & scuff bandpasses");
console.log("  [PASS] Unified realistic footsteps verified (identical on platform and in train)");

console.log("\n=== 7. TESTING HALVED EMERGENCY BRAKE VOLUMES ===");
// Inspect ramp values in _playBimmelStrike
let bimmelPeakGains = [];
const origGain = audio.ctx.createGain.bind(audio.ctx);
audio.ctx.createGain = () => {
    const g = origGain();
    const origRamp = g.gain.linearRampToValueAtTime.bind(g.gain);
    g.gain.linearRampToValueAtTime = (val, t) => {
        bimmelPeakGains.push(val);
        origRamp(val, t);
    };
    return g;
};
audio._playBimmelStrike(0.1);
// Check peak gains: should be 0.175, 0.09, 0.06 (half of previous 0.35, 0.18, 0.12)
assert.ok(bimmelPeakGains.includes(0.175), "Bimmel strike peak gain is halved to 0.175");
assert.ok(bimmelPeakGains.includes(0.09), "Bimmel overtone peak gain is halved to 0.09");
assert.ok(bimmelPeakGains.includes(0.06), "Bimmel sparkle peak gain is halved to 0.06");

// Inspect release beep volume: should be 0.12 and 0.03 (half of previous 0.24 and 0.06)
bimmelPeakGains = [];
audio.playEmergencyBrakeRelease();
assert.ok(bimmelPeakGains.includes(0.12), "Emergency brake release beep peak gain is halved to 0.12");
assert.ok(bimmelPeakGains.includes(0.03), "Emergency brake release overtone peak gain is halved to 0.03");
console.log("  [PASS] Halved emergency brake volumes verified");

console.log("\n=== 8. TESTING OVERHAULED REALISTIC ESCALATOR SYNTH ===");
assert.ok(audio.escMasterGain, "Escalator master gain created");
assert.ok(audio.escMotorGain, "Escalator motor gain created");
assert.ok(audio.escTrackGain, "Escalator track roller gain created");
assert.ok(audio.escPercGain, "Escalator percussion gain created");

// Test gains: motor hum 1/4 (0.04), clicks half of 0.21 (0.105)
assert.strictEqual(audio.escMotorGain.gain.value, 0.04, "Escalator motor hum is 1/4 volume (0.04)");
assert.strictEqual(audio.escPercGain.gain.value, 0.105, "Escalator clacking is half volume of 0.21 (0.105)");

// Test G1 sound adjustments:
audio.setTrainType('G1');
// Test startup sing at 5 km/h (speed in m/s: 5 / 3.6)
audio.update(5.0 / 3.6, 1.0, 0, 0.016, true);
assert.ok(audio.startupSingGain.gain.value <= 0.035, "G1 startup sing is pleasantly softened");

// Test 20 km/h inverter sound at 25 km/h (speed in m/s: 25 / 3.6)
audio.update(25.0 / 3.6, 1.0, 0, 0.016, true);
assert.ok(audio.inverterGain.gain.value > 0.12, "G1 inverter tone at >20 km/h is prominent and boosted");

// Test G1 brake squeal volume at 6 km/h (speed in m/s: 6 / 3.6)
audio.update(6.0 / 3.6, 0, 3.0, 0.016, true);
assert.ok(audio.brakeGain.gain.value <= 0.03, "G1 brake squeal volume is softened");

// Test zero proximity
audio.updateEscalatorSound(0.0, 0.016);
assert.strictEqual(audio.escMasterGain.gain.value, 0, "Escalator silent when intensity is 0");

// Test near proximity
audio.updateEscalatorSound(1.0, 0.016);
assert.ok(audio.escMasterGain.gain.value > 0.3, "Escalator audible with high proximity");

// Test pre-rendered buffers (processor-friendly, zero dynamic node allocations)
assert.ok(audio.escKlickBuffer, "Escalator Klick buffer created");
assert.ok(audio.escKlockBuffer, "Escalator Klock buffer created");

// Test click buffer playback
let bufferPlayed = null;
const origCreateBuf = audio.ctx.createBufferSource.bind(audio.ctx);
audio.ctx.createBufferSource = () => {
    const src = origCreateBuf();
    const origStart = src.start.bind(src);
    src.start = (t) => {
        bufferPlayed = src.buffer;
        origStart(t);
    };
    return src;
};

// Play Klick
bufferPlayed = null;
audio.playEscClick(false);
assert.strictEqual(bufferPlayed, audio.escKlickBuffer, "playEscClick(false) plays Klick buffer");

// Play Klock
bufferPlayed = null;
audio.playEscClick(true);
assert.strictEqual(bufferPlayed, audio.escKlockBuffer, "playEscClick(true) plays Klock buffer");

// Test 4-beat cycle: Klick, Klick, Klock, Pause
audio.ctx.currentTime = 100.0;
audio.escNextClickTime = 0;
audio.escStepIdx = 0;

let playedSequence = [];
audio.playEscClick = (isKlock, time) => {
    playedSequence.push(isKlock ? 'Klock' : 'Klick');
};

// Advance through 4 beats (0, 1, 2, 3)
for (let b = 0; b < 4; b++) {
    audio.ctx.currentTime = 100.0 + b * 0.25;
    audio.updateEscalatorSound(0.8, 0.016);
}

// Sequence must be: Klick (0), Klick (1), Klock (2), and no hit on Pause (3)
assert.deepStrictEqual(playedSequence, ['Klick', 'Klick', 'Klock'], "Rhythm follows Klick - Klick - Klock - (Pause)");
assert.strictEqual(audio.escStepIdx, 4, "4 beats advanced in full cycle");

console.log("  [PASS] Processor-friendly escalator synth verified (pre-rendered buffers, bassig/rumplig Klock, Klick-Klick-Klock-Pause cycle)");

console.log("\n========================================");
console.log("ALL AUDIO AND EMERGENCY BRAKE TESTS PASSED!");

