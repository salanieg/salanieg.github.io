// ============================================================================
// AudioManager.js — Komplett synthetisierte Fahr- und UI-Geräusche (Web Audio).
//
// KI-LANDKARTE (wo bearbeite ich was):
//   - Routing/Init: init() baut master -> dry/reverb -> destination.
//   - Dauerhafte Fahr-Synths (laufen immer, Lautstärke wird pro Frame in
//     update() gesteuert): setupMotorSynth (Inverter/Anfahr-Singen/DT1-Rumpeln),
//     setupBrakeSynth, setupRollingNoise, setupEscalatorSynth.
//   - update(speed, throttle, brakePressure, dt, isInside): HEISSER PFAD,
//     jede Lautstärke-/Frequenzformel für Fahrgeräusche steht hier.
//   - One-Shot-Sounds: playDoor*/playHorn/playTone/playFootstep/playCabSwitch/
//     playAutopilotChime.
//   - debugMix: Multiplikatoren des Sound-Mixer-HUDs (Taste N, main.js).
//     Kanal-Liste dort und Keys hier müssen übereinstimmen!
// ============================================================================

const VMAX = 80;

export class AudioManager {
    constructor() {
        this.ctx = null;

        // Nodes
        this.masterVolume = null;
        this.reverbNode = null;
        this.reverbGain = null;
        this.dryGain = null;

        // Motor synth nodes (der frühere Motor-Brummton wurde entfernt;
        // übrig ist nur noch der Inverter)
        this.inverterOsc = null;
        this.inverterGain = null;
        this.inverterOsc2 = null;
        this.inverterGain2 = null;
        this.inverterOsc3 = null;
        this.inverterGain3 = null;

        // G1 Motor & Getriebe nodes (additive harmonic synthesis)
        this.motorOsc0 = null;
        this.motorOsc1 = null;
        this.motorOsc2 = null;
        this.motorOsc3 = null;
        this.motorMix0 = null;
        this.motorMix1 = null;
        this.motorMix2 = null;
        this.motorMix3 = null;
        this.motorGainNode = null;

        // G1 Inverter nodes (1400/1600 Hz carrier / 3200, 2300 & 4000 Hz bright startup whine)
        this.inverterGainNode = null;
        this.g1InverterOsc1 = null;
        this.g1InverterOsc1b = null;
        this.g1InverterOsc2 = null;
        this.g1InverterOsc2b = null;
        this.g1InverterOsc2c = null;
        this.g1InvMix1 = null;
        this.g1InvMix1b = null;
        this.g1InvMix2 = null;
        this.g1InvMix2b = null;
        this.g1InvMix2c = null;

        // Throttling / Caching flags for processor-friendliness
        this._lastG1Speed = -999;
        this._g1FreqInitialized = false;
        this._lastIsInside = null;

        // G1 Roll aliases
        this.rollFilter = null;
        this.rollGainNode = null;

        // G1 Rail impacts generator (deactivated)
        this.impactIntervalMs = Infinity;
        this.railImpactBuffer = null;
        this.nextImpactTime = 0;

        // Startup sing nodes
        this.startupSingOsc = null;
        this.startupSingLFO = null;
        this.startupSingLFOGain = null;
        this.startupSingGain = null;
        this.startupSphericalOsc = null;
        this.startupSphericalGain = null;


        // Brake squeal nodes
        this.brakeGain = null;
        this.brakeOsc = null;

        // Nodes für Rollgeräusche
        this.noiseBuffer = null;
        this.rollingNoiseSource = null;
        this.rollingFilter = null;
        this.rollingGain = null;

        // Escalator nodes (Motor drone, roller track rush, handrail glide, pre-rendered step clacks)
        this.escMasterGain = null;
        this.escMotorGain = null;
        this.escTrackGain = null;
        this.escPercGain = null;
        this.escNextClickTime = 0;
        this.escStepIdx = 0;
        this.escKlickBuffer = null;
        this.escKlockBuffer = null;

        // Master Mobile Phone Speaker Processing Nodes
        this.phoneHighpass = null;
        this.phoneHighpass2 = null;
        this.phoneWarmth = null;
        this.phonePresence = null;
        this.phoneCompressor = null;

        // Constant Ambiance Synths (Train & Station)
        this.trainAmbianceGain = null;
        this.stationAmbianceGain = null;
        this.trainAirSource = null;
        this.trainIdleOsc1 = null;
        this.trainIdleOsc2 = null;
        this.trainIdleGain1 = null;
        this.trainIdleGain2 = null;
        this.stationNoiseSource = null;
        this.stationResOsc = null;

        this.initialized = false;
        this._footstepStepIdx = 0;
        this.isEmergencyBraking = false;
        this._lastSpeedKmh = 0;

        this.trainType = 'G1'; // 'G1', 'DT1', or 'DT3'
        this.dt1RumbleOsc = null;
        this.dt1RumbleGain = null;
        this.dt1GrowlOsc = null;
        this.dt1GrowlGain = null;

        // Debug-Mixer (Taste N): Multiplikatoren pro Sound-Schicht zum Testen/Justieren.
        // 1 = unverändert, 0 = stumm. Wird in update() auf die Ziel-Lautstärken angewendet.
        // WICHTIG: Keys müssen mit main.js buildSoundDebugHud() -> soundDebugChannels
        // übereinstimmen, sonst wirft das HUD beim Öffnen einen TypeError.
        this.debugMix = {
            inverter: 1,
            dt1Rumble: 1,
            dt1Growl: 1,
            startupSing: 1,
            brake: 1,
            rolling: 1,
            ambiance: 1
        };
    }

    setTrainType(type) {
        this.trainType = type;
        if (type !== 'G1') {
            if (this.motorGainNode) this.motorGainNode.gain.value = 0;
            if (this.motorMix0) this.motorMix0.gain.value = 0;
            if (this.motorMix1) this.motorMix1.gain.value = 0;
            if (this.motorMix2) this.motorMix2.gain.value = 0;
            if (this.motorMix3) this.motorMix3.gain.value = 0;
            if (this.inverterGainNode) this.inverterGainNode.gain.value = 0;
            if (this.g1InvMix1) this.g1InvMix1.gain.value = 0;
            if (this.g1InvMix1b) this.g1InvMix1b.gain.value = 0;
            if (this.g1InvMix2) this.g1InvMix2.gain.value = 0;
            if (this.g1InvMix2b) this.g1InvMix2b.gain.value = 0;
            if (this.g1InvMix2c) this.g1InvMix2c.gain.value = 0;
            this.impactIntervalMs = Infinity;
            this.nextImpactTime = 0;
        } else {
            if (this.motorMix0) this.motorMix0.gain.value = 1.0;
            if (this.motorMix1) this.motorMix1.gain.value = 0.5;
            if (this.motorMix2) this.motorMix2.gain.value = 0.5;
            if (this.motorMix3) this.motorMix3.gain.value = 0;
            if (this.g1InvMix1) this.g1InvMix1.gain.value = 0;
            if (this.g1InvMix1b) this.g1InvMix1b.gain.value = 0;
            if (this.g1InvMix2) this.g1InvMix2.gain.value = 0;
            if (this.g1InvMix2b) this.g1InvMix2b.gain.value = 0;
            if (this.g1InvMix2c) this.g1InvMix2c.gain.value = 0;
            if (this.inverterGain2) this.inverterGain2.gain.value = 0;
            if (this.inverterGain3) this.inverterGain3.gain.value = 0;
            if (this.dt1RumbleGain) this.dt1RumbleGain.gain.value = 0;
            if (this.dt1GrowlGain) this.dt1GrowlGain.gain.value = 0;
            if (this.startupSingGain) this.startupSingGain.gain.value = 0;
            if (this.startupSphericalGain) this.startupSphericalGain.gain.value = 0;
        }
    }

    init() {
        if (this.initialized) return;

        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContextClass();

            const savedVolume = localStorage.getItem('ubahnsim_volume');
            const initialVolume = savedVolume !== null ? parseFloat(savedVolume) : 0.6;

            // Master gain node
            this.masterVolume = this.ctx.createGain();
            this.masterVolume.gain.value = initialVolume;

            // Setup Reverb for realism (tunnels / stations)
            this.setupReverb();

            // Connect Master -> Reverb & Dry -> Destination
            this.dryGain = this.ctx.createGain();
            this.dryGain.gain.value = 1.0;
            this.reverbGain = this.ctx.createGain();
            this.reverbGain.gain.value = 0.0;

            this.masterVolume.connect(this.dryGain);
            this.masterVolume.connect(this.reverbNode);
            this.reverbNode.connect(this.reverbGain);

            // Connect Dry & Reverb through Mobile Phone Speaker Processing
            this.setupMasterProcessing();

            // Setup motor hum
            this.setupMotorSynth();
            this.setupG1Synths();

            // Setup brake squeal
            this.setupBrakeSynth();

            this.createNoiseBuffer();
            this.createEscalatorBuffers();
            this.createRailImpactBuffer();
            this.setupRollingNoise();

            this.setupEscalatorSynth();
            this.setupAmbianceSynths();

            this.initialized = true;
            this.ctx.resume();
        } catch (e) {
            console.error("Failed to initialize Web Audio API:", e);
        }
    }

    setupReverb() {
        this.reverbNode = this.ctx.createConvolver();
        const length = this.ctx.sampleRate * 2.5;
        const buffer = this.ctx.createBuffer(2, length, this.ctx.sampleRate);
        const left = buffer.getChannelData(0);
        const right = buffer.getChannelData(1);
        for (let i = 0; i < length; i++) {
            const decay = Math.pow(1 - i / length, 3);
            left[i] = (Math.random() * 2 - 1) * decay;
            right[i] = (Math.random() * 2 - 1) * decay;
        }
        this.reverbNode.buffer = buffer;
    }

    setupMasterProcessing() {
        // 1. Cascaded 4th-order (24 dB/oct) Linkwitz-Riley Subsonic Highpass Filter at 70 Hz
        // Eliminates subsonic rumble (<50 Hz) that forces small phone drivers to bottom out (clicking/rattling)
        // and excites boomy room modes on desktop/stereo speakers, while preserving punchy 80-200 Hz bass 100% full.
        this.phoneHighpass = this.ctx.createBiquadFilter();
        this.phoneHighpass.type = 'highpass';
        this.phoneHighpass.frequency.value = 70;
        this.phoneHighpass.Q.value = 0.7071;

        this.phoneHighpass2 = this.ctx.createBiquadFilter();
        this.phoneHighpass2.type = 'highpass';
        this.phoneHighpass2.frequency.value = 70;
        this.phoneHighpass2.Q.value = 0.7071;

        // 2. Low-Mid Clean EQ: 320 Hz, neutral (0.0 dB gain, Q = 1.0)
        // Eliminates the artificial +2.2 dB resonance bump that caused boomy/muddy "wummernd" sound on speakers.
        this.phoneWarmth = this.ctx.createBiquadFilter();
        this.phoneWarmth.type = 'peaking';
        this.phoneWarmth.frequency.value = 320;
        this.phoneWarmth.Q.value = 1.0;
        this.phoneWarmth.gain.value = 0.0;

        // 3. Presence Peaking filter: 2400 Hz, +0.8 dB, Q = 1.1
        // Smooth clarity for motor inverters, chimes, switches and airflow without harshness or click-boosting.
        this.phonePresence = this.ctx.createBiquadFilter();
        this.phonePresence.type = 'peaking';
        this.phonePresence.frequency.value = 2400;
        this.phonePresence.Q.value = 1.1;
        this.phonePresence.gain.value = 0.8;

        // 4. Master Dynamics Compressor / Transparent Bus Limiter
        // Attack time of 25 ms (0.025s) is longer than low-frequency wave cycles, preventing intra-cycle
        // waveform squaring and clicking/popping artifacts on phone speakers.
        // Release time of 250 ms (0.25s) prevents low-frequency gain fluttering.
        // Threshold -7 dB catches excessive peaks smoothly without crushing ambient dynamics.
        this.phoneCompressor = this.ctx.createDynamicsCompressor();
        this.phoneCompressor.threshold.value = -7.0;
        this.phoneCompressor.knee.value = 10;
        this.phoneCompressor.ratio.value = 2.5;
        this.phoneCompressor.attack.value = 0.025;
        this.phoneCompressor.release.value = 0.25;

        // Connect chain:
        // dryGain + reverbGain -> phoneHighpass -> phoneHighpass2 -> phoneWarmth -> phonePresence -> phoneCompressor -> destination
        this.dryGain.connect(this.phoneHighpass);
        this.reverbGain.connect(this.phoneHighpass);
        this.phoneHighpass.connect(this.phoneHighpass2);
        this.phoneHighpass2.connect(this.phoneWarmth);
        this.phoneWarmth.connect(this.phonePresence);
        this.phonePresence.connect(this.phoneCompressor);
        this.phoneCompressor.connect(this.ctx.destination);
    }

    setupMotorSynth() {
        this.inverterOsc = this.ctx.createOscillator();
        this.inverterOsc.type = 'sawtooth';
        this.inverterOsc.frequency.value = 100;

        this.inverterOsc2 = this.ctx.createOscillator();
        this.inverterOsc2.type = 'sawtooth';
        this.inverterOsc2.frequency.value = 100;

        const filter1 = this.ctx.createBiquadFilter();
        filter1.type = 'lowpass';
        filter1.frequency.value = 1200;

        const filter2 = this.ctx.createBiquadFilter();
        filter2.type = 'lowpass';
        filter2.frequency.value = 1200;

        this.inverterGain = this.ctx.createGain();
        this.inverterGain.gain.value = 0;

        this.inverterGain2 = this.ctx.createGain();
        this.inverterGain2.gain.value = 0;

        this.inverterOsc3 = this.ctx.createOscillator();
        this.inverterOsc3.type = 'sawtooth';
        this.inverterOsc3.frequency.value = 100;

        const filter3 = this.ctx.createBiquadFilter();
        filter3.type = 'lowpass';
        filter3.frequency.value = 2000;

        this.inverterGain3 = this.ctx.createGain();
        this.inverterGain3.gain.value = 0;

        this.inverterOsc.connect(filter1);
        filter1.connect(this.inverterGain);
        this.inverterGain.connect(this.masterVolume);

        this.inverterOsc2.connect(filter2);
        filter2.connect(this.inverterGain2);
        this.inverterGain2.connect(this.masterVolume);

        this.inverterOsc3.connect(filter3);
        filter3.connect(this.inverterGain3);
        this.inverterGain3.connect(this.masterVolume);

        this.startupSingOsc = this.ctx.createOscillator();
        this.startupSingOsc.type = 'sine';
        this.startupSingOsc.frequency.value = 3200;
        this.startupSingLFO = this.ctx.createOscillator();
        this.startupSingLFO.type = 'sine';
        this.startupSingLFO.frequency.value = 8.5;
        this.startupSingLFOGain = this.ctx.createGain();
        this.startupSingLFOGain.gain.value = 50;
        this.startupSingGain = this.ctx.createGain();
        this.startupSingGain.gain.value = 0;

        this.startupSphericalOsc = this.ctx.createOscillator();
        this.startupSphericalOsc.type = 'sine';
        this.startupSphericalOsc.frequency.value = 75;
        this.startupSphericalGain = this.ctx.createGain();
        this.startupSphericalGain.gain.value = 0;

        this.startupSingLFOGain.connect(this.startupSingOsc.frequency);
        this.startupSingOsc.connect(this.startupSingGain);
        // Do not connect unused prototype oscillators to masterVolume
        this.startupSphericalOsc.connect(this.startupSphericalGain);

        // Extra DT1 nodes for more rumble and mechanical grit
        this.dt1RumbleOsc = this.ctx.createOscillator();
        this.dt1RumbleOsc.type = 'sawtooth';
        this.dt1RumbleOsc.frequency.value = 50;
        const rumbleFilter = this.ctx.createBiquadFilter();
        rumbleFilter.type = 'lowpass';
        rumbleFilter.frequency.value = 150;
        this.dt1RumbleGain = this.ctx.createGain();
        this.dt1RumbleGain.gain.value = 0;

        this.dt1GrowlOsc = this.ctx.createOscillator();
        this.dt1GrowlOsc.type = 'triangle';
        this.dt1GrowlOsc.frequency.value = 80;
        this.dt1GrowlGain = this.ctx.createGain();
        this.dt1GrowlGain.gain.value = 0;

        this.dt1RumbleOsc.connect(rumbleFilter);
        rumbleFilter.connect(this.dt1RumbleGain);
        this.dt1RumbleGain.connect(this.masterVolume);

        this.dt1GrowlOsc.connect(this.dt1GrowlGain);
        this.dt1GrowlGain.connect(this.masterVolume);

        this.dt1RumbleOsc.start();
        this.dt1GrowlOsc.start();

        this.inverterOsc.start();
        this.inverterOsc2.start();
        this.inverterOsc3.start();
    }

    setupG1Synths() {
        // 1. Motor & Getriebe: 4 Oszillatoren (f0, 1. Ob, 2. Ob, 3. Ob)
        this.motorGainNode = this.ctx.createGain();
        this.motorGainNode.gain.value = 0;

        // Grundfrequenz f0: 900 Hz bei 80 km/h (Gain 1.0 - sauberes, ausgewogenes Fundament)
        this.motorOsc0 = this.ctx.createOscillator();
        this.motorOsc0.type = 'sine';
        this.motorOsc0.frequency.value = 20;
        this.motorMix0 = this.ctx.createGain();
        this.motorMix0.gain.value = 1.0;

        // 1. Oberschwingung: 1700 Hz bei 80 km/h (halb so laut: Gain 0.5)
        this.motorOsc1 = this.ctx.createOscillator();
        this.motorOsc1.type = 'sine';
        this.motorOsc1.frequency.value = 40;
        this.motorMix1 = this.ctx.createGain();
        this.motorMix1.gain.value = 0.5;

        // 2. Oberschwingung: 2400 Hz bei 80 km/h (halb so laut: Gain 0.5)
        this.motorOsc2 = this.ctx.createOscillator();
        this.motorOsc2.type = 'sine';
        this.motorOsc2.frequency.value = 60;
        this.motorMix2 = this.ctx.createGain();
        this.motorMix2.gain.value = 0.5;

        // 3. Oberschwingung: 3300 Hz bei 80 km/h (halb so laut: max 0.25, fadet 20-25 km/h ein, 60-65 km/h aus)
        this.motorOsc3 = this.ctx.createOscillator();
        this.motorOsc3.type = 'sine';
        this.motorOsc3.frequency.value = 80;
        this.motorMix3 = this.ctx.createGain();
        this.motorMix3.gain.value = 0;

        this.motorOsc0.connect(this.motorMix0);
        this.motorMix0.connect(this.motorGainNode);

        this.motorOsc1.connect(this.motorMix1);
        this.motorMix1.connect(this.motorGainNode);

        this.motorOsc2.connect(this.motorMix2);
        this.motorMix2.connect(this.motorGainNode);

        this.motorOsc3.connect(this.motorMix3);
        this.motorMix3.connect(this.motorGainNode);

        this.motorGainNode.connect(this.masterVolume);

        this.motorOsc0.start();
        this.motorOsc1.start();
        this.motorOsc2.start();
        this.motorOsc3.start();

        // 2. Inverter (Stromsound & Trägertöne)
        this.inverterGainNode = this.ctx.createGain();
        this.inverterGainNode.gain.value = 0;

        // Trägerton: 1400 Hz (halb so laut wie bisher: 0.375, fadet 5-6 km/h ein)
        this.g1InverterOsc1 = this.ctx.createOscillator();
        this.g1InverterOsc1.type = 'sine';
        this.g1InverterOsc1.frequency.value = 1400;
        this.g1InvMix1 = this.ctx.createGain();
        this.g1InvMix1.gain.value = 0;
        this.g1InverterOsc1.connect(this.g1InvMix1);
        this.g1InvMix1.connect(this.inverterGainNode);
        this.g1InverterOsc1.start();

        // Trägerton 1600 Hz (vollständig deaktiviert)
        this.g1InverterOsc1b = this.ctx.createOscillator();
        this.g1InverterOsc1b.type = 'sine';
        this.g1InverterOsc1b.frequency.value = 1600;
        this.g1InvMix1b = this.ctx.createGain();
        this.g1InvMix1b.gain.value = 0;
        this.g1InverterOsc1b.connect(this.g1InvMix1b);
        this.g1InvMix1b.connect(this.inverterGainNode);

        // Stromsound 1: 3200 Hz (Haupt-Pfeifton, fadet beim Anfahren ein)
        this.g1InverterOsc2 = this.ctx.createOscillator();
        this.g1InverterOsc2.type = 'sine';
        this.g1InverterOsc2.frequency.value = 3200;
        this.g1InvMix2 = this.ctx.createGain();
        this.g1InvMix2.gain.value = 0;
        this.g1InverterOsc2.connect(this.g1InvMix2);
        this.g1InvMix2.connect(this.inverterGainNode);
        this.g1InverterOsc2.start();

        // Stromsound 2: 2300 Hz (fadet bei 5 km/h ein, halb so laut wie 3200 Hz, fadet 10-20 km/h aus)
        this.g1InverterOsc2b = this.ctx.createOscillator();
        this.g1InverterOsc2b.type = 'sine';
        this.g1InverterOsc2b.frequency.value = 2300;
        this.g1InvMix2b = this.ctx.createGain();
        this.g1InvMix2b.gain.value = 0;
        this.g1InverterOsc2b.connect(this.g1InvMix2b);
        this.g1InvMix2b.connect(this.inverterGainNode);
        this.g1InverterOsc2b.start();

        // Stromsound 3: 4000 Hz (fadet wie Stromsound 2 bei 5 km/h ein, 10-20 km/h aus, halb so laut wie 2300 Hz: 0.0875)
        this.g1InverterOsc2c = this.ctx.createOscillator();
        this.g1InverterOsc2c.type = 'sine';
        this.g1InverterOsc2c.frequency.value = 4000;
        this.g1InvMix2c = this.ctx.createGain();
        this.g1InvMix2c.gain.value = 0;
        this.g1InverterOsc2c.connect(this.g1InvMix2c);
        this.g1InvMix2c.connect(this.inverterGainNode);
        this.g1InverterOsc2c.start();

        this.inverterGainNode.connect(this.masterVolume);
    }

    setupBrakeSynth() {
        this.brakeOsc = this.ctx.createOscillator();
        this.brakeOsc.type = 'sine';
        this.brakeOsc.frequency.value = 2500;
        const fmOsc = this.ctx.createOscillator();
        fmOsc.frequency.value = 25;
        const fmGain = this.ctx.createGain();
        fmGain.gain.value = 150;
        fmOsc.connect(fmGain);
        fmGain.connect(this.brakeOsc.frequency);
        this.brakeGain = this.ctx.createGain();
        this.brakeGain.gain.value = 0;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 2500;
        filter.Q.value = 3;
        this.brakeOsc.connect(filter);
        filter.connect(this.brakeGain);
        this.brakeGain.connect(this.masterVolume);
        fmOsc.start();
        this.brakeOsc.start();
    }

    createNoiseBuffer() {
        const duration = 2; // Sekunden
        const sampleRate = this.ctx.sampleRate;
        const bufferSize = sampleRate * duration;
        const fadeSize = Math.floor(sampleRate * 0.2); // 200ms Crossfade gegen Knacken am Loop-Punkt

        this.noiseBuffer = this.ctx.createBuffer(1, bufferSize, sampleRate);
        const output = this.noiseBuffer.getChannelData(0);
        
        // Wir erzeugen etwas mehr Samples als nötig, um das Ende mit dem Anfang überblenden zu können
        const temp = new Float32Array(bufferSize + fadeSize);
        let lastOut = 0;
        for (let i = 0; i < temp.length; i++) {
            const white = Math.random() * 2 - 1;
            // Erzeugt \"Braunes Rauschen\" durch Akkumulation (Tiefpass-Filterung von weißem Rauschen)
            temp[i] = (lastOut + (0.02 * white)) / 1.02;
            lastOut = temp[i];
        }

        for (let i = 0; i < bufferSize; i++) {
            let val = temp[i];
            if (i < fadeSize) {
                // Crossfade: Mixe den Überhang (temp[bufferSize...]) in den Anfang
                const alpha = i / fadeSize;
                val = (temp[i] * alpha) + (temp[bufferSize + i] * (1 - alpha));
            }
            // Das Ergebnis ist naturgemäß sehr leise, deshalb verstärken wir es hier
            output[i] = val * 4.0;
        }
    }

    createEscalatorBuffers() {
        const sampleRate = this.ctx.sampleRate || 44100;
        const length = Math.floor(sampleRate * 0.16); // 160ms pro Stufenanschlag

        const generate = (isKlock) => {
            const buffer = this.ctx.createBuffer(1, length, sampleRate);
            const data = buffer.getChannelData(0);

            for (let i = 0; i < length; i++) {
                const t = i / sampleRate;

                // 1. Tiefer mechanischer Bass-Thump & satter Struktur-Rumble (bassig & rumplig)
                const baseFreq = isKlock ? 88 : 125;
                const endFreq = isKlock ? 52 : 80;
                const freqDecay = Math.exp(-t * (isKlock ? 18 : 22));
                const instFreq = endFreq + (baseFreq - endFreq) * freqDecay;
                const phase = 2 * Math.PI * instFreq * t;

                const bodyEnv = Math.exp(-t * (isKlock ? 28 : 36));
                const body = Math.sin(phase) * (isKlock ? 0.65 : 0.48) * bodyEnv;
                const bodyHarmonic = Math.sin(phase * 2.0) * (isKlock ? 0.28 : 0.22) * Math.exp(-t * 38);

                // Mechanische Rumpel-Textur (geformtes Rumpelrauschen der Stufenführung)
                const noise = (Math.sin(i * 12.9898) * 43758.5453 % 1);
                const rumbleEnv = Math.exp(-t * (isKlock ? 32 : 45));
                const rumble = noise * (isKlock ? 0.22 : 0.16) * rumbleEnv;

                // 2. Solider metallischer Plattenklank (etwas dumpfer & wärmer abgestimmt)
                const plateFreq1 = isKlock ? 320 : 420;
                const plateFreq2 = isKlock ? 580 : 760;
                const ring1 = Math.sin(2 * Math.PI * plateFreq1 * t) * (isKlock ? 0.32 : 0.26) * Math.exp(-t * 45);
                const ring2 = Math.sin(2 * Math.PI * plateFreq2 * t) * (isKlock ? 0.15 : 0.12) * Math.exp(-t * 65);

                // 3. Gedämpfter Kammblech-Impuls (sanfter und dumpfer)
                const transFreq = isKlock ? 1200 : 1500;
                const transient = Math.sin(2 * Math.PI * transFreq * t) * 0.10 * Math.exp(-t * 120);

                // Warme, physische Sättigung
                const raw = body + bodyHarmonic + rumble + ring1 + ring2 + transient;
                data[i] = Math.tanh(raw * 1.1) * 0.85;
            }
            return buffer;
        };

        this.escKlickBuffer = generate(false);
        this.escKlockBuffer = generate(true);
    }

    createRailImpactBuffer() {
        const sampleRate = this.ctx.sampleRate || 44100;
        const length = Math.floor(sampleRate * 0.08); // 80ms Impuls pro Stoß
        this.railImpactBuffer = this.ctx.createBuffer(1, length, sampleRate);
        const data = this.railImpactBuffer.getChannelData(0);

        for (let i = 0; i < length; i++) {
            const t = i / sampleRate;

            // Achse 1: Stoß bei t = 0 (Körperschall-Thump + metallischer Schienenklick)
            const body1 = Math.sin(2 * Math.PI * (110 - 40 * t) * t) * Math.exp(-t * 55) * 0.6;
            const click1 = Math.sin(2 * Math.PI * 1650 * t) * Math.exp(-t * 180) * 0.35;
            const noise1 = (Math.sin(i * 12.9898) * 43758.5453 % 1) * Math.exp(-t * 90) * 0.2;

            // Achse 2: Zweites Rad des Drehgestells passiert Schienenstoß bei ~28ms
            let axle2 = 0;
            if (t > 0.028) {
                const t2 = t - 0.028;
                const body2 = Math.sin(2 * Math.PI * (120 - 45 * t2) * t2) * Math.exp(-t2 * 60) * 0.45;
                const click2 = Math.sin(2 * Math.PI * 1850 * t2) * Math.exp(-t2 * 200) * 0.25;
                const noise2 = (Math.sin((i + 500) * 12.9898) * 43758.5453 % 1) * Math.exp(-t2 * 95) * 0.15;
                axle2 = body2 + click2 + noise2;
            }

            const raw = body1 + click1 + noise1 + axle2;
            data[i] = Math.tanh(raw * 1.2) * 0.8;
        }
    }

    playRailImpact(time, volume = 0.2) {
        if (!this.initialized || !this.railImpactBuffer) return;
        const now = (typeof time === 'number' && time > 0) ? time : this.ctx.currentTime;
        const src = this.ctx.createBufferSource();
        src.buffer = this.railImpactBuffer;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(volume, now);
        src.connect(gain);
        gain.connect(this.masterVolume);
        src.start(now);
    }

    setupRollingNoise() {
        // Rollgeräusch (Schienen) konfigurieren
        this.rollingNoiseSource = this.ctx.createBufferSource();
        this.rollingNoiseSource.buffer = this.noiseBuffer;
        this.rollingNoiseSource.loop = true;
        
        this.rollingFilter = this.ctx.createBiquadFilter();
        this.rollingFilter.type = 'lowpass';
        this.rollingFilter.frequency.value = 200; // Startet sehr dumpf
        
        this.rollingGain = this.ctx.createGain();
        this.rollingGain.gain.value = 0;

        this.rollingNoiseSource.connect(this.rollingFilter);
        this.rollingFilter.connect(this.rollingGain);
        this.rollingGain.connect(this.masterVolume);
        this.rollingNoiseSource.start();

        this.rollFilter = this.rollingFilter;
        this.rollGainNode = this.rollingGain;
    }

    setupEscalatorSynth() {
        this.escMasterGain = this.ctx.createGain();
        this.escMasterGain.gain.value = 0;

        // Hochpass auf 45 Hz abgesenkt, damit der satte, rumplige Bass der Stufen voll durchdringt
        const escHP = this.ctx.createBiquadFilter();
        escHP.type = 'highpass';
        escHP.frequency.value = 45;

        // ----------------------------------------------------
        // 1. Motor & Gearbox Drive (Der Rolltreppen-Antrieb)
        // ----------------------------------------------------
        // Continuous AC induction motor running at ~98 Hz (50Hz grid / 100Hz motor hum)
        const motorOsc = this.ctx.createOscillator();
        motorOsc.type = 'triangle';
        motorOsc.frequency.value = 98;

        const motorFilter = this.ctx.createBiquadFilter();
        motorFilter.type = 'lowpass';
        motorFilter.frequency.value = 260;

        // Gearbox whine (Worm gear tooth meshing ~588 Hz)
        const gearOsc = this.ctx.createOscillator();
        gearOsc.type = 'sine';
        gearOsc.frequency.value = 588;

        const gearFilter = this.ctx.createBiquadFilter();
        gearFilter.type = 'bandpass';
        gearFilter.frequency.value = 588;
        gearFilter.Q.value = 4.0;

        const gearGain = this.ctx.createGain();
        gearGain.gain.value = 0.01; // 1/4 volume: subtle, characteristic mechanical drone

        gearOsc.connect(gearFilter);
        gearFilter.connect(gearGain);

        this.escMotorGain = this.ctx.createGain();
        this.escMotorGain.gain.value = 0.06; // Solider, sonorer Motorklang

        motorOsc.connect(motorFilter);
        motorFilter.connect(this.escMotorGain);
        gearGain.connect(this.escMotorGain);

        this.escMotorGain.connect(escHP);
        motorOsc.start();
        gearOsc.start();

        // ----------------------------------------------------
        // 2. Track Rollers & Chain Rushing (Kettenlauf & Rollen)
        // ----------------------------------------------------
        const trackNoise = this.ctx.createBufferSource();
        trackNoise.buffer = this.noiseBuffer;
        trackNoise.loop = true;

        // Bandpass to capture the metallic roller rush (600 - 1600 Hz)
        const trackBP = this.ctx.createBiquadFilter();
        trackBP.type = 'bandpass';
        trackBP.frequency.value = 920;
        trackBP.Q.value = 1.5;

        // Handrail friction glide (soft hiss around 2200 Hz)
        const handrailNoise = this.ctx.createBufferSource();
        handrailNoise.buffer = this.noiseBuffer;
        handrailNoise.loop = true;

        const handrailHP = this.ctx.createBiquadFilter();
        handrailHP.type = 'highpass';
        handrailHP.frequency.value = 2200;

        const handrailGain = this.ctx.createGain();
        handrailGain.gain.value = 0.02;

        handrailNoise.connect(handrailHP);
        handrailHP.connect(handrailGain);

        this.escTrackGain = this.ctx.createGain();
        this.escTrackGain.gain.value = 0.0; // Kettenlaufgeräusch entfernt / deaktiviert

        trackNoise.connect(trackBP);
        trackBP.connect(this.escTrackGain);
        handrailGain.connect(this.escTrackGain);

        this.escTrackGain.connect(escHP);
        trackNoise.start();
        handrailNoise.start();

        // ----------------------------------------------------
        // 3. Step Clacks & Comb Plate Clicks (Kammblech & Stufen)
        // ----------------------------------------------------
        // Sanfter Tiefpass-Filter (1600 Hz) für ein angenehm dumpferes, realistisches Rolltreppen-Klappern
        const escPercLP = this.ctx.createBiquadFilter();
        escPercLP.type = 'lowpass';
        escPercLP.frequency.value = 1600;

        this.escPercGain = this.ctx.createGain();
        this.escPercGain.gain.value = 0.14; // Deutliches, sattes Klick-Klack-Klappern

        this.escPercGain.connect(escPercLP);
        escPercLP.connect(escHP);

        escHP.connect(this.escMasterGain);
        this.escMasterGain.connect(this.masterVolume);
    }

    createCabinAmbiance(audioCtx, masterGainNode) {
        const ambianceGain = audioCtx.createGain();
        ambianceGain.gain.value = 0.038; // Grundlautstärke der Ambiance (angemessene geringe Lautstärke)
        ambianceGain.connect(masterGainNode);

        // 1. 50 Hz & 100 Hz Netzbrummen
        const hum50 = audioCtx.createOscillator();
        hum50.type = 'sine';
        hum50.frequency.value = 50;

        const hum100 = audioCtx.createOscillator();
        hum100.type = 'sine';
        hum100.frequency.value = 100;

        const humGain50 = audioCtx.createGain();
        humGain50.gain.value = 0.35;
        const humGain100 = audioCtx.createGain();
        humGain100.gain.value = 0.15;

        hum50.connect(humGain50).connect(ambianceGain);
        hum100.connect(humGain100).connect(ambianceGain);

        hum50.start();
        hum100.start();

        // 2. Klimaanlage / Luftrauschen (Pink Noise via Buffer)
        const bufferSize = audioCtx.sampleRate * 2; // 2 Sekunden Loop
        const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            b0 = 0.99886 * b0 + white * 0.0555179;
            b1 = 0.99332 * b1 + white * 0.0750759;
            b2 = 0.96900 * b2 + white * 0.1538520;
            output[i] = (b0 + b1 + b2) * 0.1;
        }

        const noiseSource = audioCtx.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        noiseSource.loop = true;

        // Dumpfer Tiefpass für Innenraum-Dämmung
        const hvacFilter = audioCtx.createBiquadFilter();
        hvacFilter.type = 'lowpass';
        hvacFilter.frequency.value = 380;

        const hvacGain = audioCtx.createGain();
        hvacGain.gain.value = 0.5;

        noiseSource.connect(hvacFilter).connect(hvacGain).connect(ambianceGain);
        noiseSource.start();

        // 3. Subtile 200-Hz-Kastenresonanz
        const resonanceFilter = audioCtx.createBiquadFilter();
        resonanceFilter.type = 'bandpass';
        resonanceFilter.frequency.value = 200;
        resonanceFilter.Q.value = 3.5;

        const resonanceGain = audioCtx.createGain();
        resonanceGain.gain.value = 0.2;

        noiseSource.connect(resonanceFilter).connect(resonanceGain).connect(ambianceGain);

        // Keep references for audio tests & lifecycle
        this.trainAirSource = noiseSource;
        this.trainIdleOsc1 = hum50;
        this.trainIdleOsc2 = hum100;
        this.trainIdleGain1 = humGain50;
        this.trainIdleGain2 = humGain100;

        return ambianceGain;
    }

    playStationAmbiance(audioCtx, masterGainNode = this.masterVolume) {
        // Station Ambiance Master Gain für distanzabhängige Modulation
        const stationAmbianceGain = audioCtx.createGain();
        stationAmbianceGain.gain.value = 0.18;
        if (masterGainNode) {
            stationAmbianceGain.connect(masterGainNode);
        } else {
            stationAmbianceGain.connect(audioCtx.destination);
        }

        // 1. Hohler Wind (1 Sekunde Rauschen im Loop)
        const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;
        noise.loop = true;

        // Dieser Filter erzeugt den Röhren-Klang:
        const tunnelFilter = audioCtx.createBiquadFilter();
        tunnelFilter.type = 'bandpass';
        tunnelFilter.frequency.value = 250; // Dumpfer Hohlraum
        tunnelFilter.Q.value = 3.0;         // Je höher, desto mehr "Tunnel"

        const noiseGain = audioCtx.createGain();
        noiseGain.gain.value = 0.3;

        noise.connect(tunnelFilter).connect(noiseGain).connect(stationAmbianceGain);
        noise.start(0);

        // 2. Tiefes Brummen (50 Hz Trafo - dezent im Hintergrund, übertönt nicht die Rolltreppe)
        const hum = audioCtx.createOscillator();
        hum.type = 'sine';
        hum.frequency.value = 50;

        const humGain = audioCtx.createGain();
        humGain.gain.value = 0.04;

        hum.connect(humGain).connect(stationAmbianceGain);
        hum.start(0);

        // Send a portion to the reverb node to create depth
        if (this.reverbNode) {
            const stationReverbSend = audioCtx.createGain();
            stationReverbSend.gain.value = 0.35;
            stationAmbianceGain.connect(stationReverbSend);
            stationReverbSend.connect(this.reverbNode);
        }

        // Keep references on instance for diagnostics/lifecycle
        this.stationNoiseSource = noise;
        this.stationResOsc = hum;
        this.stationNoiseGain = noiseGain;
        this.stationHumGain = humGain;

        return stationAmbianceGain;
    }

    setupAmbianceSynths() {
        // 1. Constant Train Ambiance Synth:
        // 50 Hz & 100 Hz Netzbrummen, Pink Noise Klimaanlage (380 Hz Lowpass) & 200 Hz Kastenresonanz
        this.trainAmbianceGain = this.createCabinAmbiance(this.ctx, this.masterVolume);

        // 2. Constant Station Ambiance Synth:
        // Hohler Wind (250 Hz Bandpass, Q=3.0) & 50 Hz Trafo-Brummen
        this.stationAmbianceGain = this.playStationAmbiance(this.ctx, this.masterVolume);
    }

    playEscClick(isKlock = false, time) {
        if (!this.initialized || !this.escKlickBuffer) return;
        const now = (typeof time === 'number' && time > 0) ? time : this.ctx.currentTime;
        const src = this.ctx.createBufferSource();
        src.buffer = isKlock ? this.escKlockBuffer : this.escKlickBuffer;
        src.connect(this.escPercGain);
        src.start(now);
    }

    updateEscalatorSound(intensity, dt, doorFactor = 1.0) {
        if (!this.initialized) return;

        const effectiveIntensity = Math.max(0, Math.min(1, intensity)) * doorFactor;
        // Smoothly fade master volume based on proximity (halb so laut: 0.275)
        const targetVol = effectiveIntensity * 0.275;
        if (Math.abs(this.escMasterGain.gain.value - targetVol) > 0.0001 || (targetVol === 0 && this.escMasterGain.gain.value > 0)) {
            this.escMasterGain.gain.setTargetAtTime(targetVol, this.ctx.currentTime, 0.08);
        }

        if (effectiveIntensity < 0.01) {
            this.escNextClickTime = 0;
            return;
        }

        const now = this.ctx.currentTime;
        const stepInterval = 0.25; // 0.25s Takt -> 1.0s pro 4er-Zyklus (Klick, Klick, Klock, Pause)

        // Initialisiere die Audio-Timeline beim Starten oder Wiederannähern
        if (!this.escNextClickTime || this.escNextClickTime < now) {
            this.escNextClickTime = now + 0.02;
        }

        // Hardware-präzises Lookahead-Scheduling auf der Audio-Clock:
        // Beat 0: Klick
        // Beat 1: Klick
        // Beat 2: Klock (tiefer, satter Bass-Thump & Rumpeln!)
        // Beat 3: Pause
        while (this.escNextClickTime < now + 0.12) {
            const beat = this.escStepIdx % 4;
            if (beat === 0 || beat === 1) {
                this.playEscClick(false, this.escNextClickTime); // Klick
            } else if (beat === 2) {
                this.playEscClick(true, this.escNextClickTime);  // Klock (bassig & rumplig)
            }
            // beat === 3 ist die kurze mechanische Pause vor dem nächsten Umlauf

            this.escStepIdx++;
            this.escNextClickTime += stepInterval;
        }
    }

    updateTrainAudio(speedKmh, isBraking) {
        const motorOsc0 = this.motorOsc0;
        const motorOsc1 = this.motorOsc1;
        const motorOsc2 = this.motorOsc2;
        const motorGainNode = this.motorGainNode;
        const inverterGainNode = this.inverterGainNode;
        const rollFilter = this.rollFilter;
        const rollGainNode = this.rollGainNode;
        const now = this.ctx.currentTime;

        // Clamp speed
        const v = Math.min(Math.max(speedKmh, 0), 80);
        const vNorm = v / 80;

        // 1. Motor & Getriebe ("2. Stufe" fadet zwischen 10 und 15 km/h ein)
        // Frequenzen bei 80 km/h: f0 = 900 Hz, f1 = 1700 Hz, f2 = 2400 Hz, f3 = 3300 Hz
        const f0 = 11.25 * v;
        const f1 = 21.25 * v;
        const f2 = 30.0 * v;
        const f3 = 41.25 * v;

        const freq0 = Math.max(f0, 20);
        const freq1 = Math.max(f1, 40);
        const freq2 = Math.max(f2, 60);
        const freq3 = Math.max(f3, 80);

        // CPU-freundlich: Frequenzen nur bei spürbarer Änderung updaten
        if (Math.abs(this._lastG1Speed - v) > 0.04 || !this._g1FreqInitialized) {
            this._g1FreqInitialized = true;
            this._lastG1Speed = v;
            motorOsc0.frequency.setTargetAtTime(freq0, now, 0.03);
            motorOsc1.frequency.setTargetAtTime(freq1, now, 0.03);
            motorOsc2.frequency.setTargetAtTime(freq2, now, 0.03);
            if (this.motorOsc3) {
                this.motorOsc3.frequency.setTargetAtTime(freq3, now, 0.03);
            }
        }

        // "2. Stufe": Grundfrequenz und 1.-3. Oberschwingung faden von 5-10 km/h ein (vor 5 km/h komplett stumm)
        const motorFade = Math.max(0, Math.min(1, (v - 5) / 5));
        const motorGain = 0.06 * Math.pow(vNorm, 0.7) * motorFade;

        if (Math.abs(motorGainNode.gain.value - motorGain) > 0.0005 || motorGain > 0.0001) {
            motorGainNode.gain.setTargetAtTime(motorGain, now, 0.04);
        }

        // 3. Oberschwingung: fadet bei 5-10 km/h mit dem Motor ein und bei 60-65 km/h aus (Mix 0.25)
        if (this.motorMix3) {
            const harm3Out = Math.max(0, Math.min(1, (65 - v) / 5));
            const targetMix3 = 0.25 * motorFade * harm3Out;
            if (Math.abs(this.motorMix3.gain.value - targetMix3) > 0.005 || targetMix3 > 0.0001) {
                this.motorMix3.gain.setTargetAtTime(targetMix3, now, 0.04);
            }
        }

        // 2. Inverter (Trägerton 1400 Hz / Stromsound 3200, 2300 & 4000 Hz)
        // Bei Stillstand (unter 0.2 km/h) herrscht absolute Stille
        let targetInverterVol = 0.0;
        if (v >= 0.2 && v <= 40) {
            targetInverterVol = isBraking ? (0.03 * 1.3) : 0.03;
        }
        if (targetInverterVol === 0) {
            if (inverterGainNode.gain.value > 0.0001) {
                inverterGainNode.gain.setTargetAtTime(0, now, 0.02);
            }
        } else if (Math.abs(inverterGainNode.gain.value - targetInverterVol) > 0.0005) {
            inverterGainNode.gain.setTargetAtTime(targetInverterVol, now, 0.04);
        }

        // Ausfaden des Stromsounds (wie gehabt zwischen 10 und 20 km/h)
        const fadeOutWhine = Math.max(0, Math.min(1, (20 - v) / 10));

        // Stromsound 1 (3200 Hz): fadet von 0.2 bis 1.0 km/h auf 100% (Mix 0.35), fadet wie gehabt 10-20 km/h aus
        const fadeIn3200 = Math.max(0, Math.min(1, (v - 0.2) / 0.8));
        const targetMix2 = (v < 0.2) ? 0 : 0.35 * fadeIn3200 * fadeOutWhine;
        if (this.g1InvMix2) {
            if (targetMix2 === 0) {
                if (this.g1InvMix2.gain.value > 0.0001) {
                    this.g1InvMix2.gain.setTargetAtTime(0, now, 0.02);
                }
            } else if (Math.abs(this.g1InvMix2.gain.value - targetMix2) > 0.001) {
                this.g1InvMix2.gain.setTargetAtTime(targetMix2, now, 0.04);
            }
        }

        // Gemeinsames Einfaden von 5-11 km/h und Ausfaden von 15-16 km/h für Stromsound 2 (2300 Hz) & 3 (4000 Hz)
        const fadeInStrom23 = Math.max(0, Math.min(1, (v - 5) / 6));
        const fadeOutStrom23 = Math.max(0, Math.min(1, (16 - v) / 1));
        const envStrom23 = fadeInStrom23 * fadeOutStrom23;

        // Stromsound 2 (2300 Hz): fadet 5-11 km/h ein, 15-16 km/h aus, halb so laut wie 3200 Hz (Mix 0.175)
        const targetMix2b = (v <= 5.0 || v >= 16.0) ? 0 : 0.175 * envStrom23;
        if (this.g1InvMix2b) {
            if (targetMix2b === 0) {
                if (this.g1InvMix2b.gain.value > 0.0001) {
                    this.g1InvMix2b.gain.setTargetAtTime(0, now, 0.02);
                }
            } else if (Math.abs(this.g1InvMix2b.gain.value - targetMix2b) > 0.001) {
                this.g1InvMix2b.gain.setTargetAtTime(targetMix2b, now, 0.04);
            }
        }

        // Stromsound 3 (4000 Hz): verhält sich wie der 2., aber nur halb so laut (Mix 0.0875)
        const targetMix2c = (v <= 5.0 || v >= 16.0) ? 0 : 0.0875 * envStrom23;
        if (this.g1InvMix2c) {
            if (targetMix2c === 0) {
                if (this.g1InvMix2c.gain.value > 0.0001) {
                    this.g1InvMix2c.gain.setTargetAtTime(0, now, 0.02);
                }
            } else if (Math.abs(this.g1InvMix2c.gain.value - targetMix2c) > 0.001) {
                this.g1InvMix2c.gain.setTargetAtTime(targetMix2c, now, 0.04);
            }
        }

        // Einziger Trägerton (1400 Hz): fadet von 5-6 km/h ein, halb so laut wie bisher (Mix 0.375), fadet 35-37 km/h aus
        const carrierFadeIn = Math.max(0, Math.min(1, (v - 5) / 1));
        const carrierFadeOut = Math.max(0, Math.min(1, (37 - v) / 2));
        const carrierEnv = carrierFadeIn * carrierFadeOut;
        const targetMix1 = (v <= 5.0 || v >= 37.0) ? 0 : 0.375 * carrierEnv;

        if (this.g1InvMix1) {
            if (targetMix1 === 0) {
                if (this.g1InvMix1.gain.value > 0.0001) {
                    this.g1InvMix1.gain.setTargetAtTime(0, now, 0.02);
                }
            } else if (Math.abs(this.g1InvMix1.gain.value - targetMix1) > 0.001) {
                this.g1InvMix1.gain.setTargetAtTime(targetMix1, now, 0.04);
            }
        }
        if (this.g1InvMix1b) {
            if (this.g1InvMix1b.gain.value > 0.0001) {
                this.g1InvMix1b.gain.setTargetAtTime(0, now, 0.04);
            }
        }

        // 3. Rollgeräusch (Wind/Fahrt/Rumpelgeräusch das vorher da war und immer lauter wird)
        if (v > 0.1) {
            const volCurve = Math.pow(vNorm, 1.5);
            const targetVol = volCurve * 3.0 * (this.debugMix.rolling ?? 1);
            if (Math.abs(rollGainNode.gain.value - targetVol) > 0.005) {
                rollGainNode.gain.setTargetAtTime(targetVol, now, 0.1);
            }
            const cutoffFreq = 200 + 400 * vNorm;
            if (Math.abs(rollFilter.frequency.value - cutoffFreq) > 1.0) {
                rollFilter.frequency.setTargetAtTime(cutoffFreq, now, 0.1);
            }
        } else {
            if (rollGainNode.gain.value > 0.0001) {
                rollGainNode.gain.setTargetAtTime(0, now, 0.2);
            }
            if (Math.abs(rollFilter.frequency.value - 200) > 1.0) {
                rollFilter.frequency.setTargetAtTime(200, now, 0.2);
            }
        }

        // 4. Schienenstöße Impulsgenerator (deaktiviert: kein Schienenklackern)
        this.impactIntervalMs = Infinity;
    }

    update(speed, throttle, brakePressure, dt, isInside = false, stationDistance = Infinity, isPlatform = false, doorProgress = 1.0, isInsideTrain = false) {
        if (!this.initialized) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();

        const targetReverb = isInside ? 0.45 : 0.05;
        const targetDry = isInside ? 0.75 : 1.0;
        if (this._lastIsInside !== isInside) {
            this._lastIsInside = isInside;
            this.reverbGain.gain.setTargetAtTime(targetReverb, this.ctx.currentTime, 0.5);
            this.dryGain.gain.setTargetAtTime(targetDry, this.ctx.currentTime, 0.5);
        }

        const speedKmh = speed * 3.6;
        this._lastSpeedKmh = speedKmh;
        const isDT1 = this.trainType === 'DT1';
        const isDT3 = this.trainType === 'DT3';
        const isG1 = this.trainType === 'G1';

        if (isG1) {
            const isBraking = brakePressure > 0.5 || throttle < -0.05;
            this.updateTrainAudio(speedKmh, isBraking);

            // Silence DT1 / DT3 specific synths smoothly without clicks
            const now = this.ctx.currentTime;
            if (this.inverterGain.gain.value > 0.0001) this.inverterGain.gain.setTargetAtTime(0, now, 0.08);
            if (this.inverterGain2.gain.value > 0.0001) this.inverterGain2.gain.setTargetAtTime(0, now, 0.08);
            if (this.inverterGain3.gain.value > 0.0001) this.inverterGain3.gain.setTargetAtTime(0, now, 0.08);
            if (this.dt1RumbleGain.gain.value > 0.0001) this.dt1RumbleGain.gain.setTargetAtTime(0, now, 0.08);
            if (this.dt1GrowlGain.gain.value > 0.0001) this.dt1GrowlGain.gain.setTargetAtTime(0, now, 0.08);
            if (this.startupSingGain.gain.value > 0.0001) this.startupSingGain.gain.setTargetAtTime(0, now, 0.08);
            if (this.startupSphericalGain.gain.value > 0.0001) this.startupSphericalGain.gain.setTargetAtTime(0, now, 0.08);
        } else if (speedKmh > 0.05) {
            // Inverter: DT1 has a low hum, DT3 has stepped whine.
            const effort = Math.max(Math.abs(throttle), Math.min(1.0, brakePressure / 5));
            let inverterFreq = 100;
            let targetInverterVol = 0;
            let inverterFreq2 = 100;
            let targetInverterVol2 = 0;
            let inverterFreq3 = 100;
            let targetInverterVol3 = 0;

            if (isDT1) {
                if (this.inverterOsc.type !== 'sawtooth') this.inverterOsc.type = 'sawtooth';
                if (this.inverterOsc2.type !== 'sawtooth') this.inverterOsc2.type = 'sawtooth';
                if (this.inverterOsc3.type !== 'sawtooth') this.inverterOsc3.type = 'sawtooth';

                const freqRamp = Math.min(1.0, speedKmh / 2.0); // Frequenz-Einfaden bis 2 km/h
                inverterFreq = 20 + 240 * freqRamp;
                inverterFreq2 = 20 + 180 * freqRamp;
                inverterFreq3 = 20 + (speedKmh / 80) * 980;

                const baseVol = 0.02;
                const volRamp = Math.min(1.0, speedKmh / 2.0); // Lautstärke-Einfaden für Ton 3

                targetInverterVol = (effort > 0.02
                    ? effort * baseVol
                    : 0) * this.debugMix.inverter;
                targetInverterVol2 = targetInverterVol * 0.5;
                targetInverterVol3 = targetInverterVol * 0.5 * volRamp;
            } else if (isDT3) {
                if (this.inverterOsc.type !== 'sine') this.inverterOsc.type = 'sine';
                if (this.inverterOsc2.type !== 'sine') this.inverterOsc2.type = 'sine';
                if (this.inverterOsc3.type !== 'sawtooth') this.inverterOsc3.type = 'sawtooth';

                const ratio = Math.min(1.0, speedKmh / 80);
                inverterFreq = 20 + 380 * ratio; // Sine 1: 20-400 Hz
                inverterFreq2 = 1000 + 1000 * ratio; // Sine 2: 1000-2000 Hz
                inverterFreq3 = 20 + 980 * ratio; // Sawtooth: 20-1000 Hz

                const baseVol = 0.035;
                targetInverterVol = (effort > 0.02 ? effort * baseVol * 2.0 : 0) * this.debugMix.inverter;

                // Fades in between 0 and 2 km/h
                const fadeIn = Math.min(1.0, speedKmh / 2.0);
                targetInverterVol2 = targetInverterVol * 0.5 * fadeIn;
                targetInverterVol3 = targetInverterVol * 0.35 * fadeIn;
            }

            this.inverterOsc.frequency.setTargetAtTime(inverterFreq, this.ctx.currentTime, 0.15);
            this.inverterGain.gain.setTargetAtTime(targetInverterVol, this.ctx.currentTime, 0.1);

            this.inverterOsc2.frequency.setTargetAtTime(inverterFreq2, this.ctx.currentTime, 0.15);
            this.inverterGain2.gain.setTargetAtTime(targetInverterVol2, this.ctx.currentTime, 0.1);

            this.inverterOsc3.frequency.setTargetAtTime(inverterFreq3, this.ctx.currentTime, 0.15);
            this.inverterGain3.gain.setTargetAtTime(targetInverterVol3, this.ctx.currentTime, 0.1);

            // DT1 Specific extra mechanical rumble
            if (isDT1) {
                const rumbleFreq = 15 + speedKmh * 0.5;
                this.dt1RumbleOsc.frequency.setTargetAtTime(rumbleFreq, this.ctx.currentTime, 0.1);
                const rumbleVol = effort * 0.04 * Math.min(1.0, speedKmh / 10) * this.debugMix.dt1Rumble;
                this.dt1RumbleGain.gain.setTargetAtTime(rumbleVol, this.ctx.currentTime, 0.2);

                const growlFreq = 40 + speedKmh * 1.5;
                this.dt1GrowlOsc.frequency.setTargetAtTime(growlFreq, this.ctx.currentTime, 0.1);
                const growlVol = effort * 0.025 * Math.min(1.0, speedKmh / 20) * this.debugMix.dt1Growl;
                this.dt1GrowlGain.gain.setTargetAtTime(growlVol, this.ctx.currentTime, 0.2);
            } else {
                this.dt1RumbleGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
                this.dt1GrowlGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
            }
        } else {
            this.inverterGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
            this.inverterGain2.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
            this.inverterGain3.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
            this.dt1RumbleGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
            this.dt1GrowlGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
        }

        if (!isG1) {
            if (this.startupSingGain.gain.value > 0.0001) this.startupSingGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
            if (this.startupSphericalGain.gain.value > 0.0001) this.startupSphericalGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
        }

        // Brake squeal:
        // Bei Notbremsung setzt das Standard-Bremsgeräusch sofort ein und bleibt aktiv solange der Zug rollt
        if (this.isEmergencyBraking && speedKmh > 0.2) {
            const brakeBaseVol = (this.trainType === 'G1') ? 0.03 : 0.045;
            const volume = brakeBaseVol * this.debugMix.brake;
            this.brakeGain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.03);
            this.brakeGain.gain.value = volume;
            const pitch = (isDT1 ? 1400 : 1800) + Math.min(speedKmh, 50) * 40;
            this.brakeOsc.frequency.setTargetAtTime(pitch, this.ctx.currentTime, 0.04);
            this.brakeOsc.frequency.value = pitch;
        } else if (!this.isEmergencyBraking && speedKmh > 0.5 && speedKmh < 18 && brakePressure > 1.5) {
            const speedFactor = 1 - Math.abs(speedKmh - 6) / 10;
            const brakeBaseVol = (this.trainType === 'G1') ? 0.03 : 0.045;
            const volume = Math.max(0, speedFactor) * (brakePressure / 5) * brakeBaseVol * this.debugMix.brake;
            this.brakeGain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.1);
            this.brakeGain.gain.value = volume;
            // DT1 brake squeal is slightly lower pitched
            const pitch = (isDT1 ? 1400 : 1800) + speedKmh * 80;
            this.brakeOsc.frequency.setTargetAtTime(pitch, this.ctx.currentTime, 0.1);
            this.brakeOsc.frequency.value = pitch;
        } else {
            if (this.brakeGain.gain.value > 0.0001) {
                this.brakeGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
                this.brakeGain.gain.value = 0;
            }
        }

        // --- ROLLGERÄUSCH (Schienen) for DT1 / DT3 ---
        if (!isG1) {
            if (speedKmh > 0.1) {
                const volCurve = Math.pow(Math.min(speedKmh / VMAX, 1.0), 1.5);
                const rollingMultiplier = isDT1 ? 4.5 : 3.0;
                this.rollingGain.gain.setTargetAtTime(volCurve * rollingMultiplier * this.debugMix.rolling, this.ctx.currentTime, 0.2);

                const cutoffMin = isDT1 ? 150 : 200;
                const cutoffMax = isDT1 ? 500 : 600;
                const cutoffFreq = cutoffMin + (cutoffMax - cutoffMin) * (speedKmh / VMAX);
                this.rollingFilter.frequency.setTargetAtTime(cutoffFreq, this.ctx.currentTime, 0.2);
            } else {
                this.rollingGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
            }
        }

        // --- AMBIANCE (Zug & Station) ---
        const ambMult = (this.debugMix && this.debugMix.ambiance !== undefined) ? this.debugMix.ambiance : 1.0;

        // 1. Station Ambiance:
        // Im Zug nur hörbar wenn Türen offen/öffnend; auf dem Bahnsteig/außen immer hörbar
        if (this.stationAmbianceGain) {
            let targetStationVol = 0.05; // baseline tunnel acoustics
            if (isPlatform || stationDistance < 45) {
                targetStationVol = 0.18; // atmospheric station presence (dezent, überdeckt nicht die Rolltreppe)
            } else if (stationDistance < 130) {
                const frac = 1.0 - (stationDistance - 45) / 85;
                targetStationVol = 0.05 + 0.13 * frac;
            }

            // Wenn im Zug: Schallschutz der Wagenkastenstruktur, fadet synchron mit Türöffnung (doorProgress 0..1) ein
            const doorFactor = isInsideTrain ? Math.max(0, Math.min(1, doorProgress)) : 1.0;
            const desiredStationVol = targetStationVol * doorFactor * ambMult;

            if (Math.abs(this.stationAmbianceGain.gain.value - desiredStationVol) > 0.0005) {
                const fadeTime = isInsideTrain ? 0.08 : 0.4;
                this.stationAmbianceGain.gain.setTargetAtTime(desiredStationVol, this.ctx.currentTime, fadeTime);
                this.stationAmbianceGain.gain.value = desiredStationVol;
            }
        }

        // 2. Train Ambiance:
        // Always consistent ("immer gleichbleibend"), subtle electrical idling and ventilation presence
        if (this.trainAmbianceGain) {
            const baseTrainVol = isInside ? 0.038 : 0.022;
            const desiredTrainVol = baseTrainVol * ambMult;
            if (Math.abs(this.trainAmbianceGain.gain.value - desiredTrainVol) > 0.0005) {
                this.trainAmbianceGain.gain.setTargetAtTime(desiredTrainVol, this.ctx.currentTime, 0.3);
                this.trainAmbianceGain.gain.value = desiredTrainVol;
            }
        }
    }

    playDoorWarning() {
        if (!this.initialized) return;
        const now = this.ctx.currentTime;
        const isDT1 = this.trainType === 'DT1';

        if (isDT1) {
            const totalDuration = 3.3;
            const interval = totalDuration / 24;
            const beepCount = 24;
            const duration = 0.04;
            const volume = 0.1; // Halb so laut (von 0.2)
            const freq = 1800;
            for (let i = 0; i < beepCount; i++) {
                const time = now + i * interval;
                this.playTone(freq, duration, volume, time);
            }
            return;
        }

        const beepCount = 11;
        const interval = 1 / 3;
        for (let i = 0; i < beepCount; i++) {
            const time = now + i * interval;
            const isHigh = (i % 2 === 0);
            const freq = isHigh ? 1000 : 500;
            this.playTone(freq, 0.33, 0.06, time, 'sine'); // Halb so laut (von 0.12)
            if (isHigh) {
                // Bei 1000 Hz zusätzlich ein halb so lauter 2000 Hz Ton
                this.playTone(2000, 0.33, 0.03, time, 'sine'); // Halb so laut (von 0.06)
            }
        }
    }

    playDoorUnlock() {
        if (!this.initialized) return;
        const now = this.ctx.currentTime;
        const osc1 = this.ctx.createOscillator();
        const gain1 = this.ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(3200, now);
        osc1.frequency.exponentialRampToValueAtTime(500, now + 0.02);
        gain1.gain.setValueAtTime(0.7, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.02);
        osc1.connect(gain1);
        gain1.connect(this.masterVolume);
        osc1.start(now);
        osc1.stop(now + 0.03);

        const bufferSize = Math.floor(this.ctx.sampleRate * 0.04);
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1400, now);
        filter.Q.setValueAtTime(4.0, now);
        const gainNoise = this.ctx.createGain();
        gainNoise.gain.setValueAtTime(0.4, now);
        gainNoise.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
        noise.connect(filter);
        filter.connect(gainNoise);
        gainNoise.connect(this.masterVolume);
        noise.start(now);
        noise.stop(now + 0.04);

        const osc2 = this.ctx.createOscillator();
        const gain2 = this.ctx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(260, now);
        osc2.frequency.linearRampToValueAtTime(90, now + 0.06);
        gain2.gain.setValueAtTime(0.5, now);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        osc2.connect(gain2);
        gain2.connect(this.masterVolume);
        osc2.start(now);
        osc2.stop(now + 0.08);
    }

    playDoorSlide(duration = 1.25, delay = 0) {
        if (!this.initialized) return;
        const now = this.ctx.currentTime + delay;
        const isDT1 = this.trainType === 'DT1';

        const bufferSize = Math.floor(this.ctx.sampleRate * duration);
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(isDT1 ? 800 : 1000, now);
        const gainNoise = this.ctx.createGain();
        gainNoise.gain.setValueAtTime(0, now);
        gainNoise.gain.linearRampToValueAtTime(isDT1 ? 0.05 : 0.02, now + 0.15); // G1 halb so laut (von 0.04 auf 0.02)
        gainNoise.gain.setValueAtTime(isDT1 ? 0.05 : 0.02, now + duration - 0.2);
        gainNoise.gain.exponentialRampToValueAtTime(0.001, now + duration);
        noise.connect(filter);
        filter.connect(gainNoise);
        gainNoise.connect(this.masterVolume);
        noise.start(now);
        noise.stop(now + duration);

        const osc = this.ctx.createOscillator();
        const gainOsc = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(isDT1 ? 160 : 220, now);
        osc.frequency.linearRampToValueAtTime(isDT1 ? 180 : 240, now + duration);
        const lfo = this.ctx.createOscillator();
        lfo.frequency.value = isDT1 ? 40 : 35;
        const lfoGain = this.ctx.createGain();
        lfoGain.gain.value = isDT1 ? 15 : 10;
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        gainOsc.gain.setValueAtTime(0, now);
        gainOsc.gain.linearRampToValueAtTime(isDT1 ? 0.025 : 0.015, now + 0.1); // G1 halb so laut (von 0.03 auf 0.015)
        gainOsc.gain.setValueAtTime(isDT1 ? 0.025 : 0.015, now + duration - 0.15);
        gainOsc.gain.exponentialRampToValueAtTime(0.001, now + duration);
        osc.connect(gainOsc);
        gainOsc.connect(this.masterVolume);
        lfo.start(now);
        osc.start(now);
        lfo.stop(now + duration);
        osc.stop(now + duration);

        // DT1 metallic rattle: heavier, deeper and more mechanical
        if (isDT1) {
            // 1. Deep Heavy Rumble ("Grollen")
            const rumbleOsc = this.ctx.createOscillator();
            const rumbleGain = this.ctx.createGain();
            rumbleOsc.type = 'triangle';
            rumbleOsc.frequency.setValueAtTime(45, now);
            rumbleOsc.frequency.exponentialRampToValueAtTime(38, now + duration);
            rumbleGain.gain.setValueAtTime(0, now);
            rumbleGain.gain.linearRampToValueAtTime(0.18, now + 0.2);
            rumbleGain.gain.setValueAtTime(0.18, now + duration - 0.2);
            rumbleGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
            rumbleOsc.connect(rumbleGain);
            rumbleGain.connect(this.masterVolume);
            rumbleOsc.start(now);
            rumbleOsc.stop(now + duration);

            // 2. Mechanical Rattle ("Rattern & Rumpeln")
            const rattleBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const rattleData = rattleBuffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) rattleData[i] = Math.random() * 2 - 1;
            const rattleNoise = this.ctx.createBufferSource();
            rattleNoise.buffer = rattleBuffer;
            const rattleFilter = this.ctx.createBiquadFilter();
            rattleFilter.type = 'lowpass';
            rattleFilter.frequency.setValueAtTime(500, now);
            rattleFilter.Q.setValueAtTime(3.0, now);

            const rattleGain = this.ctx.createGain();
            const rattleLFO = this.ctx.createOscillator();
            rattleLFO.type = 'sawtooth';
            rattleLFO.frequency.setValueAtTime(12, now);
            const rattleLFOGain = this.ctx.createGain();
            rattleLFOGain.gain.setValueAtTime(0.45, now);
            rattleLFO.connect(rattleLFOGain);
            rattleLFOGain.connect(rattleGain.gain);

            const rattleBaseGain = this.ctx.createGain();
            rattleBaseGain.gain.setValueAtTime(0, now);
            rattleBaseGain.gain.linearRampToValueAtTime(0.24, now + 0.25);
            rattleBaseGain.gain.setValueAtTime(0.24, now + duration - 0.35);
            rattleBaseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

            rattleNoise.connect(rattleFilter);
            rattleFilter.connect(rattleGain);
            rattleGain.connect(rattleBaseGain);
            rattleBaseGain.connect(this.masterVolume);

            rattleLFO.start(now);
            rattleNoise.start(now);
            rattleLFO.stop(now + duration);
            rattleNoise.stop(now + duration);
        }
    }

    playDoorThud() {
        if (!this.initialized) return;
        const now = this.ctx.currentTime;
        const isDT1 = this.trainType === 'DT1';

        const oscThump = this.ctx.createOscillator();
        const gainThump = this.ctx.createGain();
        oscThump.type = 'triangle';
        oscThump.frequency.setValueAtTime(isDT1 ? 90 : 110, now);
        oscThump.frequency.exponentialRampToValueAtTime(isDT1 ? 25 : 30, now + 0.45);
        gainThump.gain.setValueAtTime(isDT1 ? 0.6 : 0.5, now);
        gainThump.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        oscThump.connect(gainThump);
        gainThump.connect(this.masterVolume);
        oscThump.start(now);
        oscThump.stop(now + 0.5);

        const oscSub = this.ctx.createOscillator();
        const gainSub = this.ctx.createGain();
        oscSub.type = 'sine';
        oscSub.frequency.setValueAtTime(isDT1 ? 55 : 65, now);
        oscSub.frequency.exponentialRampToValueAtTime(isDT1 ? 28 : 32, now + 0.6);
        gainSub.gain.setValueAtTime(isDT1 ? 0.55 : 0.45, now);
        gainSub.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
        oscSub.connect(gainSub);
        gainSub.connect(this.masterVolume);
        oscSub.start(now);
        oscSub.stop(now + 0.7);

        const bufferSize = Math.floor(this.ctx.sampleRate * 0.6);
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(isDT1 ? 120 : 90, now);
        const gainNoise = this.ctx.createGain();
        gainNoise.gain.setValueAtTime(isDT1 ? 0.5 : 0.4, now);
        gainNoise.gain.exponentialRampToValueAtTime(0.001, now + (isDT1 ? 0.45 : 0.35));
        noise.connect(filter);
        filter.connect(gainNoise);
        gainNoise.connect(this.masterVolume);
        noise.start(now);
        noise.stop(now + 0.5);

        if (isDT1) {
            // Extra metallic ring on impact
            const ring = this.ctx.createOscillator();
            const ringGain = this.ctx.createGain();
            ring.type = 'triangle';
            ring.frequency.setValueAtTime(300, now);
            ring.frequency.exponentialRampToValueAtTime(150, now + 0.15);
            ringGain.gain.setValueAtTime(0.2, now);
            ringGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
            ring.connect(ringGain);
            ringGain.connect(this.masterVolume);
            ring.start(now);
            ring.stop(now + 0.2);
        }
    }

    playAutopilotChime(isActivated) {
        if (!this.initialized) return;
        const now = this.ctx.currentTime;
        const vol = 0.25;
        if (isActivated) {
            this.playTone(523.25, 0.25, vol, now);
            this.playTone(659.25, 0.25, vol, now + 0.15);
            this.playTone(783.99, 0.4, vol, now + 0.3);
        } else {
            this.playTone(783.99, 0.25, vol, now);
            this.playTone(622.25, 0.25, vol, now + 0.15);
            this.playTone(523.25, 0.4, vol, now + 0.3);
        }
    }

    playCabSwitch() {
        if (!this.initialized) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(150, now + 0.04);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
        osc.connect(gain);
        gain.connect(this.masterVolume);
        osc.start(now);
        osc.stop(now + 0.05);
    }

    playHorn() {
        if (!this.initialized || this.hornActive) return;
        this.hornActive = true;

        // Minimaler Zeitpuffer für sauberen Start
        const time = this.ctx.currentTime + 0.02;

        const lfo = this.ctx.createOscillator();
        lfo.frequency.setValueAtTime(1.5, time);

        const lfoGain = this.ctx.createGain();
        lfoGain.gain.setValueAtTime(8, time);
        lfo.connect(lfoGain);

        const frequencies = [350, 450, 700, 800];
        const waveTypes = ['square', 'square', 'triangle', 'triangle'];

        this.hornOscs = frequencies.map((freq, index) => {
            const osc = this.ctx.createOscillator();
            osc.type = waveTypes[index];
            osc.frequency.setValueAtTime(freq, time);

            lfoGain.connect(osc.frequency);
            osc.detune.setValueAtTime((index - 1.5) * 4, time);

            return osc;
        });

        this.hornGain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1100;
        filter.Q.value = 3.5;

        // Lautstärke bei Start auf 0 setzen und weich auf 0.35 ziehen
        this.hornGain.gain.setValueAtTime(0, time);
        this.hornGain.gain.setTargetAtTime(0.35, time, 0.05);

        this.hornOscs.forEach(osc => {
            osc.connect(filter);
            osc.start(time);
        });

        lfo.start(time);
        this.hornLfo = lfo;

        filter.connect(this.hornGain);
        this.hornGain.connect(this.masterVolume);
    }

    stopHorn() {
        if (!this.initialized || !this.hornActive) return;
        const time = this.ctx.currentTime;

        // Weich auf 0 abklingen lassen
        this.hornGain.gain.setTargetAtTime(0, time, 0.03);

        // Oszillatoren erst nach dem Fade-Out komplett abschalten
        const stopTime = time + 0.3;

        this.hornOscs.forEach(osc => osc.stop(stopTime));
        this.hornLfo.stop(stopTime);

        this.hornActive = false;
    }

    playTone(freq, duration, volume, time, type = 'sine') {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, time);

        // Lowpass filter to \"mellow\" the sound (entschärfen)
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1500, time);
        filter.Q.setValueAtTime(0.5, time);

        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(volume, time + 0.02);
        gain.gain.setValueAtTime(volume, time + duration - 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterVolume);
        osc.start(time);
        osc.stop(time + duration + 0.1);
    }

    playFootstep(volume = 0.24) {
        if (!this.initialized || !this.ctx) return;
        const now = this.ctx.currentTime;

        // Wechselnder Schritt-Index für organische links/rechts Variation
        this._footstepStepIdx = (this._footstepStepIdx || 0) + 1;
        const isLeft = (this._footstepStepIdx % 2 === 0);

        // Feine organische Tonhöhen- und Klangfarben-Variation
        const pitchVar = isLeft ? 1.02 : 0.98;
        const microVar = 1.0 + (Math.random() * 0.06 - 0.03);
        const totalPitch = pitchVar * microVar;

        // Master-Gain für diesen Einzelschritt
        const stepGain = this.ctx.createGain();
        stepGain.gain.setValueAtTime(volume, now);

        // 1. Knackiger Fersen-Absatz-Klick (Schuhabsatz trifft Boden)
        const heelOsc = this.ctx.createOscillator();
        heelOsc.type = 'triangle';
        heelOsc.frequency.setValueAtTime(1450 * totalPitch, now);
        heelOsc.frequency.exponentialRampToValueAtTime(360 * totalPitch, now + 0.025);

        const heelFilter = this.ctx.createBiquadFilter();
        heelFilter.type = 'bandpass';
        heelFilter.frequency.setValueAtTime(2250 * totalPitch, now);
        heelFilter.Q.setValueAtTime(2.2, now);

        const heelGain = this.ctx.createGain();
        heelGain.gain.setValueAtTime(0.0001, now);
        heelGain.gain.linearRampToValueAtTime(0.70, now + 0.002);
        heelGain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

        heelOsc.connect(heelFilter);
        heelFilter.connect(heelGain);
        heelGain.connect(stepGain);

        heelOsc.start(now);
        heelOsc.stop(now + 0.04);

        // 2. Tiefer Körperschall-Druck (Gewichtsübertragung beim Auftreten)
        const bodyOsc = this.ctx.createOscillator();
        bodyOsc.type = 'sine';
        bodyOsc.frequency.setValueAtTime(160 * totalPitch, now);
        bodyOsc.frequency.exponentialRampToValueAtTime(48 * totalPitch, now + 0.07);

        const bodyGain = this.ctx.createGain();
        bodyGain.gain.setValueAtTime(0.0001, now);
        bodyGain.gain.linearRampToValueAtTime(0.55, now + 0.004);
        bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

        bodyOsc.connect(bodyGain);
        bodyGain.connect(stepGain);

        bodyOsc.start(now);
        bodyOsc.stop(now + 0.09);

        // 3. Körniger Sohlenabrieb / Reibungs-Textur beim Abrollen
        if (this.noiseBuffer) {
            const scuff = this.ctx.createBufferSource();
            scuff.buffer = this.noiseBuffer;
            const scuffFilter = this.ctx.createBiquadFilter();
            scuffFilter.type = 'bandpass';
            scuffFilter.frequency.setValueAtTime(1800 * totalPitch, now);
            scuffFilter.Q.setValueAtTime(1.8, now);

            const scuffGain = this.ctx.createGain();
            scuffGain.gain.setValueAtTime(0.0001, now);
            scuffGain.gain.linearRampToValueAtTime(0.28, now + 0.005);
            scuffGain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

            scuff.connect(scuffFilter);
            scuffFilter.connect(scuffGain);
            scuffGain.connect(stepGain);

            scuff.start(now);
            scuff.stop(now + 0.05);
        }

        // Routing: Einheitlich trocken ins Master + dezenter natürlicher Raumhall
        stepGain.connect(this.masterVolume);
        if (this.reverbNode) {
            const reverbSend = this.ctx.createGain();
            reverbSend.gain.setValueAtTime(0.25, now);
            stepGain.connect(reverbSend);
            reverbSend.connect(this.reverbNode);
        }
    }

    playEmergencyBrakeAlarm() {
        if (!this.initialized) return;
        const now = this.ctx.currentTime;
        const strikes = 6;
        const interval = 0.105; // 6x schnell hintereinander (~0.6s gesamt)

        for (let i = 0; i < strikes; i++) {
            const t = now + i * interval;
            this._playBimmelStrike(t);
        }

        // Standard-Bremsgeräusch setzt im Falle der Notbremsung sofort ein
        this.isEmergencyBraking = true;
        if (this.brakeGain && this.brakeOsc) {
            const isDT1 = this.trainType === 'DT1';
            const brakeBaseVol = (this.trainType === 'G1') ? 0.03 : 0.045;
            const volume = brakeBaseVol * this.debugMix.brake;
            const speed = this._lastSpeedKmh || 0;
            const pitch = (isDT1 ? 1400 : 1800) + Math.min(speed, 50) * 40;

            if (this.brakeGain.gain.cancelScheduledValues) this.brakeGain.gain.cancelScheduledValues(now);
            this.brakeGain.gain.setValueAtTime(this.brakeGain.gain.value, now);
            this.brakeGain.gain.linearRampToValueAtTime(volume, now + 0.02); // Sofort einsetzen!
            this.brakeGain.gain.value = volume;

            if (this.brakeOsc.frequency.cancelScheduledValues) this.brakeOsc.frequency.cancelScheduledValues(now);
            this.brakeOsc.frequency.setValueAtTime(pitch, now);
            this.brakeOsc.frequency.value = pitch;

            // Falls der Zug bereits steht (speed <= 0.2 km/h), Bremsgeräusch nach kurzem Biss ausblenden
            if (speed <= 0.2) {
                this.brakeGain.gain.setValueAtTime(volume, now + 0.7);
                this.brakeGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.3);
                this.brakeGain.gain.linearRampToValueAtTime(0, now + 1.32);
            }
        }
    }

    _playBimmelStrike(time) {
        // Helles Warnglocken-Bimmeln mit harmonischen Obertönen (auf Wunsch nur halb so laut)
        const osc1 = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const osc3 = this.ctx.createOscillator();

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(1760, time); // A6 (Hauptglocke)

        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(2489, time); // D#7 (chime-Oberton)

        osc3.type = 'triangle';
        osc3.frequency.setValueAtTime(3520, time); // A7 (Attack-Sparkle)

        const gain1 = this.ctx.createGain();
        const gain2 = this.ctx.createGain();
        const gain3 = this.ctx.createGain();

        // Knackige Anschlag-Hüllkurve (halbierte Lautstärke)
        gain1.gain.setValueAtTime(0.0001, time);
        gain1.gain.linearRampToValueAtTime(0.07, time + 0.003);
        gain1.gain.exponentialRampToValueAtTime(0.001, time + 0.090);

        gain2.gain.setValueAtTime(0.0001, time);
        gain2.gain.linearRampToValueAtTime(0.035, time + 0.003);
        gain2.gain.exponentialRampToValueAtTime(0.001, time + 0.075);

        gain3.gain.setValueAtTime(0.0001, time);
        gain3.gain.linearRampToValueAtTime(0.022, time + 0.002);
        gain3.gain.exponentialRampToValueAtTime(0.001, time + 0.045);

        osc1.connect(gain1);
        osc2.connect(gain2);
        osc3.connect(gain3);

        gain1.connect(this.masterVolume);
        gain2.connect(this.masterVolume);
        gain3.connect(this.masterVolume);

        osc1.start(time);
        osc2.start(time);
        osc3.start(time);

        osc1.stop(time + 0.10);
        osc2.stop(time + 0.10);
        osc3.stop(time + 0.10);
    }

    playEmergencyBrakeRelease() {
        if (!this.initialized) return;
        this.isEmergencyBraking = false;
        const now = this.ctx.currentTime;

        // Bremsgeräusch beim Lösen der Notbremse sofort beenden
        if (this.brakeGain) {
            this.brakeGain.gain.setTargetAtTime(0, now, 0.05);
            this.brakeGain.gain.value = 0;
        }

        // 1. Kurzes harmonisches Klingeln (melodischer 2-Klang A5 -> C#6 mit Obertönen)
        this._playHarmonicReleaseChime(now);

        // 2. 3 Sekunden lang der Kompressor des U-Bahn-Zugs
        this._playCompressorSound(now, 3.0);

        // 3. Zischen, das sofort einfadet und bis Sekunde 3 ausfadet
        this._playReleaseHiss(now, 3.0);
    }

    _playHarmonicReleaseChime(time) {
        // Glockenton 1: A5 (880 Hz) + Oktave (1760 Hz)
        this._playSingleChimeBell(880, 1760, time, 0.08, 0.35);

        // Glockenton 2: Harmonische Dur-Terz C#6 (1108.7 Hz) + Oktave (2217 Hz) um 120ms versetzt
        this._playSingleChimeBell(1108.73, 2217.46, time + 0.12, 0.085, 0.45);
    }

    _playSingleChimeBell(freq1, freq2, time, volume, duration) {
        const osc1 = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        osc1.type = 'sine';
        osc2.type = 'sine';
        osc1.frequency.setValueAtTime(freq1, time);
        osc2.frequency.setValueAtTime(freq2, time);

        const gain1 = this.ctx.createGain();
        const gain2 = this.ctx.createGain();

        gain1.gain.setValueAtTime(0.0001, time);
        gain1.gain.linearRampToValueAtTime(volume, time + 0.004);
        gain1.gain.exponentialRampToValueAtTime(0.0005, time + duration);
        gain1.gain.linearRampToValueAtTime(0, time + duration + 0.01);

        gain2.gain.setValueAtTime(0.0001, time);
        gain2.gain.linearRampToValueAtTime(volume * 0.35, time + 0.003);
        gain2.gain.exponentialRampToValueAtTime(0.0005, time + duration * 0.7);
        gain2.gain.linearRampToValueAtTime(0, time + duration * 0.7 + 0.01);

        osc1.connect(gain1);
        osc2.connect(gain2);
        gain1.connect(this.masterVolume);
        gain2.connect(this.masterVolume);

        osc1.start(time);
        osc2.start(time);
        osc1.stop(time + duration + 0.02);
        osc2.stop(time + duration + 0.02);
    }

    _playCompressorSound(time, duration = 3.0) {
        // Authentischer U-Bahn-Kolbenkompressor / Luftpresser:
        // - 72 Hz Basismotor (Dreieck/Sägezahn) mit Tiefpass
        // - 14 Hz AM-Pulsieren für die rhythmischen Pumpstöße der Kolben
        // - 520 Hz dezentes mechanisches Getriebe-/Lüftersummen
        const motorOsc = this.ctx.createOscillator();
        motorOsc.type = 'triangle';
        motorOsc.frequency.setValueAtTime(72, time);

        const motorFilter = this.ctx.createBiquadFilter();
        motorFilter.type = 'lowpass';
        motorFilter.frequency.setValueAtTime(260, time);

        // AM-Pulsieren für Kolben-Takt (~14 Hz)
        const pulseOsc = this.ctx.createOscillator();
        pulseOsc.type = 'sine';
        pulseOsc.frequency.setValueAtTime(14, time);
        const pulseGain = this.ctx.createGain();
        pulseGain.gain.setValueAtTime(0.35, time);

        const whirOsc = this.ctx.createOscillator();
        whirOsc.type = 'sine';
        whirOsc.frequency.setValueAtTime(520, time);
        const whirGain = this.ctx.createGain();
        whirGain.gain.setValueAtTime(0.015, time);

        const compMasterGain = this.ctx.createGain();
        // Hüllkurve: Sanftes Anlaufen in 0.12s, stabiler Lauf bis 2.7s, Abschalten bis 3.0s
        compMasterGain.gain.setValueAtTime(0.0001, time);
        compMasterGain.gain.linearRampToValueAtTime(0.065, time + 0.12);
        compMasterGain.gain.setValueAtTime(0.065, time + duration - 0.3);
        compMasterGain.gain.linearRampToValueAtTime(0.0001, time + duration);

        motorOsc.connect(motorFilter);
        motorFilter.connect(compMasterGain);
        whirOsc.connect(whirGain);
        whirGain.connect(compMasterGain);

        compMasterGain.connect(this.masterVolume);

        motorOsc.start(time);
        pulseOsc.start(time);
        whirOsc.start(time);

        motorOsc.stop(time + duration + 0.05);
        pulseOsc.stop(time + duration + 0.05);
        whirOsc.stop(time + duration + 0.05);
    }

    _playReleaseHiss(time, duration = 3.0) {
        if (!this.noiseBuffer) return;

        // Pneumatisches Zischen beim Lösen der Notbremse:
        // Fadet sofort ein (15ms linear) und fadet bis Sekunde 3.0 kontinuierlich aus
        const hissSource = this.ctx.createBufferSource();
        hissSource.buffer = this.noiseBuffer;
        hissSource.loop = true;

        const hissFilter = this.ctx.createBiquadFilter();
        hissFilter.type = 'bandpass';
        hissFilter.frequency.setValueAtTime(2400, time);
        hissFilter.frequency.exponentialRampToValueAtTime(1300, time + duration);
        hissFilter.Q.value = 1.3;

        const hissGain = this.ctx.createGain();
        // Sofortiges Einfaden (0.015s) und kontinuierliches Ausfaden bis Sekunde 3.0
        hissGain.gain.setValueAtTime(0.0001, time);
        hissGain.gain.linearRampToValueAtTime(0.08, time + 0.015);
        hissGain.gain.exponentialRampToValueAtTime(0.0008, time + duration);
        hissGain.gain.linearRampToValueAtTime(0.0, time + duration + 0.02);

        hissSource.connect(hissFilter);
        hissFilter.connect(hissGain);
        hissGain.connect(this.masterVolume);

        hissSource.start(time);
        hissSource.stop(time + duration + 0.05);
    }

    setVolume(volume) {
        const vol = Math.max(0, Math.min(1, volume));
        localStorage.setItem('ubahnsim_volume', vol);
        if (this.initialized && this.ctx) {
            this.masterVolume.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.05);
        }
    }
}
