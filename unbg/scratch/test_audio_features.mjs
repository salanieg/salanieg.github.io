// test_audio_features.mjs
import assert from 'node:assert';
import { Simulation } from '../src/simulator/Simulation.js';

// Web Audio API Mock for headless testing
class AudioParamMock {
    constructor(val = 0) {
        this.value = val;
        this.events = [];
    }
    setValueAtTime(v, t) { this.events.push({ type: 'set', v, t }); this.value = v; }
    setTargetAtTime(v, t, tc) { this.events.push({ type: 'target', v, t, tc }); this.value = v; }
    linearRampToValueAtTime(v, t) { this.events.push({ type: 'linear', v, t }); this.value = v; }
    exponentialRampToValueAtTime(v, t) { this.events.push({ type: 'exp', v, t }); this.value = v; }
    cancelScheduledValues(t) { this.events.push({ type: 'cancel', t }); }
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
assert.strictEqual(audio.stationAmbianceGain.gain.value, 0.05, "Tunnel station ambiance is baseline (0.05)");
assert.strictEqual(audio.trainAmbianceGain.gain.value, 0.038, "Inside train ambiance is steady (0.038)");

// Test update at station
audio.update(0, 0, 2.0, 0.016, true, 20, false);
assert.strictEqual(audio.stationAmbianceGain.gain.value, 0.18, "Station ambiance is full presence at station (0.18)");
assert.strictEqual(audio.trainAmbianceGain.gain.value, 0.038, "Inside train ambiance remains constant at station");

// Test platform view
audio.update(0, 0, 0, 0.016, false, 500, true);
assert.strictEqual(audio.stationAmbianceGain.gain.value, 0.18, "Platform view has full station presence (0.18)");
assert.strictEqual(audio.trainAmbianceGain.gain.value, 0.022, "Exterior train ambiance is slightly softer (0.022)");

// Test inside train with closed doors (doorProgress = 0, isInsideTrain = true) -> Station silent!
audio.update(0, 0, 2.0, 0.016, false, 20, false, 0.0, true);
assert.strictEqual(audio.stationAmbianceGain.gain.value, 0, "Inside train with closed doors: station is completely silent");

// Test inside train with opening doors (doorProgress = 0.5, isInsideTrain = true) -> 50% station volume
audio.update(0, 0, 2.0, 0.016, false, 20, false, 0.5, true);
assert.ok(Math.abs(audio.stationAmbianceGain.gain.value - (0.18 * 0.5)) < 1e-6, "Inside train with half-open doors: station fades in to 50%");

// Test inside train with fully open doors (doorProgress = 1.0, isInsideTrain = true) -> 100% station volume
audio.update(0, 0, 2.0, 0.016, false, 20, false, 1.0, true);
assert.strictEqual(audio.stationAmbianceGain.gain.value, 0.18, "Inside train with open doors: full station volume (0.18)");
console.log("  [PASS] Train and station ambiance levels and door-gated transitions verified");

console.log("\n=== 3. TESTING EMERGENCY BRAKE ALARM (6x BIMMELN) ===");
let bimmelCount = 0;
const origPlayBimmel = audio._playBimmelStrike.bind(audio);
audio._playBimmelStrike = (time) => {
    bimmelCount++;
    origPlayBimmel(time);
};
audio.playEmergencyBrakeAlarm();
assert.strictEqual(bimmelCount, 6, "playEmergencyBrakeAlarm must trigger exactly 6 bimmel strikes");
assert.strictEqual(audio.isEmergencyBraking, true, "isEmergencyBraking flag is set to true on alarm");
assert.ok(audio.brakeGain.gain.events.some(e => e.v > 0), "Standard brake sound immediately engages on emergency brake alarm");

// Verify that while train is moving during emergency brake, standard brake sound remains active
audio.update(25 / 3.6, 0, 5, 0.016, true);
assert.ok(audio.brakeGain.gain.value > 0, "Standard brake squeal remains actively engaged while moving");
console.log("  [PASS] 6x rapid bimmeln alarm + immediate standard brake sound verified");

console.log("\n=== 4. TESTING EMERGENCY BRAKE RELEASE (HARMONIC CHIME + 3S COMPRESSOR + 3S HISS) ===");
let releaseChimeCreated = false;
let compressorCreated = false;
let releaseHissCreated = false;

const origChime = audio._playHarmonicReleaseChime.bind(audio);
audio._playHarmonicReleaseChime = (time) => {
    releaseChimeCreated = true;
    origChime(time);
};

const origComp = audio._playCompressorSound.bind(audio);
audio._playCompressorSound = (time, dur) => {
    compressorCreated = true;
    assert.strictEqual(dur, 3.0, "Compressor duration must be 3.0 seconds");
    origComp(time, dur);
};

const origHiss = audio._playReleaseHiss.bind(audio);
audio._playReleaseHiss = (time, dur) => {
    releaseHissCreated = true;
    assert.strictEqual(dur, 3.0, "Release hiss duration must be 3.0 seconds");
    origHiss(time, dur);
};

audio.playEmergencyBrakeRelease();
assert.ok(releaseChimeCreated, "Emergency brake release triggers short harmonic chime");
assert.ok(compressorCreated, "Emergency brake release triggers 3s compressor sound");
assert.ok(releaseHissCreated, "Emergency brake release triggers 3s fading hiss sound");
console.log("  [PASS] Harmonic chime, 3s compressor, and 3s release hiss verified");

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
assert.ok(bimmelPeakGains.includes(0.07), "Bimmel strike peak gain is halved to 0.07");
assert.ok(bimmelPeakGains.includes(0.035), "Bimmel overtone peak gain is halved to 0.035");
assert.ok(bimmelPeakGains.includes(0.022), "Bimmel sparkle peak gain is halved to 0.022");

// Inspect release chime & hiss volume:
bimmelPeakGains = [];
audio.playEmergencyBrakeRelease();
assert.ok(bimmelPeakGains.includes(0.08), "Release chime / hiss peak gain is balanced to 0.08");
console.log("  [PASS] Halved emergency brake warning bimmeln volumes verified");

console.log("\n=== 8. TESTING OVERHAULED REALISTIC ESCALATOR SYNTH ===");
assert.ok(audio.escMasterGain, "Escalator master gain created");
assert.ok(audio.escMotorGain, "Escalator motor gain created");
assert.ok(audio.escTrackGain, "Escalator track roller gain created");
assert.ok(audio.escPercGain, "Escalator percussion gain created");

// Test gains: motor hum boosted (0.06), clicks boosted (0.14), track/chain noise removed (0.0)
assert.strictEqual(audio.escMotorGain.gain.value, 0.06, "Escalator motor hum is boosted (0.06)");
assert.strictEqual(audio.escPercGain.gain.value, 0.14, "Escalator clacking is boosted (0.14)");
assert.strictEqual(audio.escTrackGain.gain.value, 0.0, "Escalator chain/track running sound is disabled (0.0)");

// Test G1 sound adjustments:
audio.setTrainType('G1');
// Test startup sing at 5 km/h (speed in m/s: 5 / 3.6)
audio.update(5.0 / 3.6, 1.0, 0, 0.016, true);
assert.ok(audio.startupSingGain.gain.value <= 0.035, "G1 startup sing is pleasantly softened");

// Test 20 km/h inverter sound at 25 km/h (speed in m/s: 25 / 3.6)
audio.update(25.0 / 3.6, 1.0, 0, 0.016, true);
assert.ok(audio.inverterGainNode.gain.value > 0.02, "G1 inverter tone at >20 km/h is prominent and boosted");

// Test G1 brake squeal volume at 6 km/h (speed in m/s: 6 / 3.6)
audio.update(6.0 / 3.6, 0, 3.0, 0.016, true);
assert.ok(audio.brakeGain.gain.value <= 0.03, "G1 brake squeal volume is softened");

// Test zero proximity
audio.updateEscalatorSound(0.0, 0.016);
assert.strictEqual(audio.escMasterGain.gain.value, 0, "Escalator silent when intensity is 0");

// Test near proximity
audio.updateEscalatorSound(1.0, 0.016);
assert.ok(audio.escMasterGain.gain.value > 0.22 && audio.escMasterGain.gain.value < 0.30, "Escalator audible with high proximity (halved to 0.275)");

// Test inside train with closed doors (doorFactor = 0)
audio.updateEscalatorSound(1.0, 0.016, 0.0);
assert.strictEqual(audio.escMasterGain.gain.value, 0, "Escalator silent inside train with closed doors");

// Test inside train with open doors (doorFactor = 1.0)
audio.updateEscalatorSound(1.0, 0.016, 1.0);
assert.ok(audio.escMasterGain.gain.value > 0.22 && audio.escMasterGain.gain.value < 0.30, "Escalator audible when doors open (0.275)");

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

console.log("\n=== 9. TESTING G1 TRAIN AUDIO (updateTrainAudio) ===");
// Test G1 Audio at 0 km/h
audio.updateTrainAudio(0, false);
assert.strictEqual(audio.motorOsc0.frequency.value, 20, "MotorOsc0 frequency clamped to 20 Hz at 0 km/h");
assert.strictEqual(audio.motorOsc1.frequency.value, 40, "MotorOsc1 frequency clamped to 40 Hz at 0 km/h");
assert.strictEqual(audio.motorOsc2.frequency.value, 60, "MotorOsc2 frequency clamped to 60 Hz at 0 km/h");
assert.strictEqual(audio.motorOsc3.frequency.value, 80, "MotorOsc3 frequency clamped to 80 Hz at 0 km/h");
assert.strictEqual(audio.motorGainNode.gain.value, 0, "Motor gain is 0 at 0 km/h");
assert.strictEqual(audio.inverterGainNode.gain.value, 0, "Inverter gain is 0 at 0 km/h");
assert.strictEqual(audio.rollFilter.frequency.value, 200, "Roll filter frequency is 200 Hz at 0 km/h");
assert.strictEqual(audio.rollGainNode.gain.value, 0, "Roll gain is 0 at 0 km/h");
assert.strictEqual(audio.impactIntervalMs, Infinity, "Impact interval is Infinity at 0 km/h");

// Test G1 Audio at 1 km/h (3200 Hz tone already 100% volume, carriers and motor silent)
audio.updateTrainAudio(1, false);
assert.ok(Math.abs(audio.g1InvMix2.gain.value - 0.35) < 1e-6, "3200 Hz tone has 100% volume (0.35) already at 1 km/h");
assert.strictEqual(audio.motorGainNode.gain.value, 0, "Motor is completely silent at 1 km/h (fades in 5-10 km/h)");
assert.strictEqual(audio.g1InvMix1.gain.value, 0, "Carrier tone 1400 Hz is silent at 1 km/h (fades in 5-7 km/h)");
assert.strictEqual(audio.g1InvMix2b.gain.value, 0, "2nd Stromsound (2300 Hz) silent below 4 km/h");
assert.strictEqual(audio.g1InvMix2c.gain.value, 0, "3rd Stromsound (4000 Hz) silent below 4 km/h");

// Test G1 Audio at 5 km/h (Stromsound 2 & 3 starting fade-in at 5 km/h)
audio.updateTrainAudio(5, false);
assert.strictEqual(audio.motorGainNode.gain.value, 0, "Motor gain is 0 below 5 km/h");
assert.ok(Math.abs(audio.g1InvMix2.gain.value - 0.35) < 1e-6, "Bright 3200 Hz whistle is still at full presence (0.35)");
assert.strictEqual(audio.g1InvMix2b.gain.value, 0, "2nd Stromsound (2300 Hz) at 0 at 5 km/h (fades in 5-11 km/h)");
assert.strictEqual(audio.g1InvMix2c.gain.value, 0, "3rd Stromsound (4000 Hz) at 0 at 5 km/h (fades in 5-11 km/h)");
assert.strictEqual(audio.g1InvMix1.gain.value, 0, "Carrier tone 1400 Hz starts fading in at 5 km/h (0.0 at 5)");
assert.strictEqual(audio.g1InvMix1b.gain.value, 0, "Carrier tone 1600 Hz is deactivated (0.0)");

// Test G1 Audio at 8 km/h (Stromsound 2 & 3 halfway faded in: (8 - 5)/6 = 0.5)
audio.updateTrainAudio(8, false);
assert.ok(Math.abs(audio.g1InvMix2b.gain.value - (0.175 * 0.5)) < 1e-6, "Stromsound 2 is 50% faded in at 8 km/h");
assert.ok(Math.abs(audio.g1InvMix2c.gain.value - (0.0875 * 0.5)) < 1e-6, "Stromsound 3 is 50% faded in at 8 km/h");

// Test G1 Audio at 11 km/h (Stromsound 2 & 3 fully faded in at 100%)
audio.updateTrainAudio(11, false);
assert.ok(Math.abs(audio.g1InvMix2b.gain.value - 0.175) < 1e-6, "Stromsound 2 (2300 Hz) 100% in at 11 km/h (0.175)");
assert.ok(Math.abs(audio.g1InvMix2c.gain.value - 0.0875) < 1e-6, "Stromsound 3 (4000 Hz) 100% in at 11 km/h (0.0875)");

// Test G1 Audio at 15.5 km/h (Stromsound 2 & 3 50% faded out: (16 - 15.5)/1 = 0.5)
audio.updateTrainAudio(15.5, false);
assert.ok(Math.abs(audio.g1InvMix2b.gain.value - (0.175 * 0.5)) < 1e-6, "Stromsound 2 is 50% faded out at 15.5 km/h");
assert.ok(Math.abs(audio.g1InvMix2c.gain.value - (0.0875 * 0.5)) < 1e-6, "Stromsound 3 is 50% faded out at 15.5 km/h");

// Test G1 Audio at 16 km/h (Stromsound 2 & 3 completely faded out)
audio.updateTrainAudio(16, false);
assert.strictEqual(audio.g1InvMix2b.gain.value, 0, "Stromsound 2 has completely faded out by 16 km/h");
assert.strictEqual(audio.g1InvMix2c.gain.value, 0, "Stromsound 3 has completely faded out by 16 km/h");

// Test G1 Audio at 20 km/h (3200 Hz whistle 100% faded out, motor fully active)
audio.updateTrainAudio(20, false);
assert.ok(Math.abs(audio.g1InvMix2.gain.value - 0.0) < 1e-6, "3200 Hz whistle has completely faded out by 20 km/h");
assert.strictEqual(audio.motorMix0.gain.value, 2.0, "Fundamental motor frequency f0 is twice as loud (gain 2.0)");
assert.strictEqual(audio.motorMix1.gain.value, 0.5, "Harmonic 1 is half as loud (gain 0.5)");
assert.strictEqual(audio.motorMix2.gain.value, 0.5, "Harmonic 2 is half as loud (gain 0.5)");

// Test G1 Audio at 36 km/h (Carrier 1400 Hz 50% faded out between 35 and 37 km/h)
audio.updateTrainAudio(36, false);
assert.ok(Math.abs(audio.g1InvMix1.gain.value - (0.375 * 0.5)) < 1e-6, "Carrier 1400 Hz is 50% faded out at 36 km/h");

// Test G1 Audio at 37 km/h (Carrier 1400 Hz 100% faded out)
audio.updateTrainAudio(37, false);
assert.ok(Math.abs(audio.g1InvMix1.gain.value - 0.0) < 1e-6, "Carrier 1400 Hz is completely faded out by 37 km/h");
assert.ok(Math.abs(audio.g1InvMix1b.gain.value - 0.0) < 1e-6, "Carrier 1600 Hz is completely faded out by 37 km/h");

// Test G1 Audio at 62.5 km/h (3rd harmonic 50% faded out)
audio.updateTrainAudio(62.5, false);
assert.ok(Math.abs(audio.motorMix3.gain.value - 0.125) < 1e-6, "3rd harmonic is 50% faded out at 62.5 km/h (0.125)");

// Test G1 Audio at 65 km/h (3rd harmonic completely faded out: 0.0)
audio.updateTrainAudio(65, false);
assert.ok(Math.abs(audio.motorMix3.gain.value - 0.0) < 1e-6, "3rd harmonic completely faded out by 65 km/h");

// Test G1 Audio at 80 km/h (vMax)
audio.updateTrainAudio(80, false);
assert.strictEqual(audio.motorOsc0.frequency.value, 900, "MotorOsc0 frequency is exactly 900 Hz at 80 km/h");
assert.strictEqual(audio.motorOsc1.frequency.value, 1700, "MotorOsc1 frequency is exactly 1700 Hz at 80 km/h");
assert.strictEqual(audio.motorOsc2.frequency.value, 2400, "MotorOsc2 frequency is exactly 2400 Hz at 80 km/h");
assert.strictEqual(audio.motorOsc3.frequency.value, 3300, "MotorOsc3 frequency is exactly 3300 Hz at 80 km/h");
assert.strictEqual(audio.motorGainNode.gain.value, 0.06, "Motor gain is 0.06 at 80 km/h");
assert.strictEqual(audio.rollFilter.frequency.value, 600, "Roll filter frequency is 600 Hz at 80 km/h");
assert.strictEqual(audio.rollGainNode.gain.value, 3.0, "Roll gain swells to full 3.0 volume at 80 km/h");
assert.strictEqual(audio.impactIntervalMs, Infinity, "Rail clack impact interval remains deactivated (Infinity) at 80 km/h");

// Test G1 Audio clamp at 100 km/h (clamped to 80)
audio.updateTrainAudio(100, false);
assert.strictEqual(audio.motorGainNode.gain.value, 0.06, "Motor gain clamped to 80 km/h value (0.06)");
assert.strictEqual(audio.rollGainNode.gain.value, 3.0, "Roll gain clamped to 80 km/h value (3.0)");

console.log("  [PASS] G1 train audio synthesis verified: rail clacks removed, restored roaring wind/rolling sound scaling up to 3.0 volume");

console.log("\n========================================");
console.log("ALL AUDIO AND EMERGENCY BRAKE TESTS PASSED!");


