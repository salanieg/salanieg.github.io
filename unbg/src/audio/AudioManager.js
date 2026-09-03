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
        this.phoneWarmth = null;
        this.phonePresence = null;
        this.phoneCompressor = null;

        // Constant Ambiance Synths (Train & Station)
        this.trainAmbianceGain = null;
        this.stationAmbianceGain = null;
        this.trainAirSource = null;
        this.trainIdleOsc1 = null;
        this.trainIdleOsc2 = null;
        this.stationNoiseSource = null;
        this.stationResOsc = null;

        this.initialized = false;
        this._footstepStepIdx = 0;

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
        if (this.ctx && this.trainIdleOsc1 && this.trainIdleOsc2) {
            if (type === 'DT1') {
                this.trainIdleOsc1.frequency.setTargetAtTime(50, this.ctx.currentTime, 0.2);
                this.trainIdleOsc2.frequency.setTargetAtTime(100, this.ctx.currentTime, 0.2);
            } else {
                this.trainIdleOsc1.frequency.setTargetAtTime(100, this.ctx.currentTime, 0.2);
                this.trainIdleOsc2.frequency.setTargetAtTime(200, this.ctx.currentTime, 0.2);
            }
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

            // Setup brake squeal
            this.setupBrakeSynth();

            this.createNoiseBuffer();
            this.createEscalatorBuffers();
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
        // 1. Highpass filter: 95 Hz, Q = 0.7
        // Cuts sub-bass rumble (<90 Hz) that mobile speaker drivers cannot physically reproduce,
        // eliminating speaker rattling/flapping and saving acoustic amplifier headroom.
        this.phoneHighpass = this.ctx.createBiquadFilter();
        this.phoneHighpass.type = 'highpass';
        this.phoneHighpass.frequency.value = 95;
        this.phoneHighpass.Q.value = 0.7;

        // 2. Warmth Peaking filter: 320 Hz, +2.2 dB, Q = 1.0
        // Adds body, warmth and weight in the low-mid spectrum where mobile speakers CAN vibrate.
        this.phoneWarmth = this.ctx.createBiquadFilter();
        this.phoneWarmth.type = 'peaking';
        this.phoneWarmth.frequency.value = 320;
        this.phoneWarmth.Q.value = 1.0;
        this.phoneWarmth.gain.value = 2.2;

        // 3. Presence Peaking filter: 2400 Hz, +3.0 dB, Q = 1.1
        // Boosts intelligibility of motor inverters, chimes, switches, bells and airflow on phone speakers.
        this.phonePresence = this.ctx.createBiquadFilter();
        this.phonePresence.type = 'peaking';
        this.phonePresence.frequency.value = 2400;
        this.phonePresence.Q.value = 1.1;
        this.phonePresence.gain.value = 3.0;

        // 4. Master Dynamics Compressor / Limiter
        // Compresses wide dynamic range so quiet ambiences are clearly audible on small phone speakers
        // without loud horns or door slams clipping.
        this.phoneCompressor = this.ctx.createDynamicsCompressor();
        this.phoneCompressor.threshold.value = -14;
        this.phoneCompressor.knee.value = 8;
        this.phoneCompressor.ratio.value = 3.5;
        this.phoneCompressor.attack.value = 0.003;
        this.phoneCompressor.release.value = 0.15;

        // Connect chain:
        // dryGain + reverbGain -> phoneHighpass -> phoneWarmth -> phonePresence -> phoneCompressor -> destination
        this.dryGain.connect(this.phoneHighpass);
        this.reverbGain.connect(this.phoneHighpass);
        this.phoneHighpass.connect(this.phoneWarmth);
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

        this.startupSingLFO.connect(this.startupSingLFOGain);
        this.startupSingLFOGain.connect(this.startupSingOsc.frequency);
        this.startupSingOsc.connect(this.startupSingGain);
        this.startupSingGain.connect(this.masterVolume);

        this.startupSphericalOsc.connect(this.startupSphericalGain);
        this.startupSphericalGain.connect(this.masterVolume);

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

        this.startupSphericalOsc.start();

        this.inverterOsc.start();
        this.inverterOsc2.start();
        this.inverterOsc3.start();
        this.startupSingOsc.start();
        this.startupSingLFO.start();
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
        this.escMotorGain.gain.value = 0.04; // 1/4 volume: soft background hum

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
        this.escTrackGain.gain.value = 0.08;

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
        this.escPercGain.gain.value = 0.105; // Halb so laut wie zuvor (0.21 / 2 = 0.105)

        this.escPercGain.connect(escPercLP);
        escPercLP.connect(escHP);

        escHP.connect(this.escMasterGain);
        this.escMasterGain.connect(this.masterVolume);
    }

    setupAmbianceSynths() {
        // 1. Constant Train Ambiance Synth:
        // Always present, subtle room tone inside the train:
        // Soft HVAC / blower airflow + gentle 100/200 Hz electrical idling drone.
        this.trainAmbianceGain = this.ctx.createGain();
        this.trainAmbianceGain.gain.value = 0.038;

        // Airflow (HVAC / ventilation blower)
        const trainAirSource = this.ctx.createBufferSource();
        trainAirSource.buffer = this.noiseBuffer;
        trainAirSource.loop = true;

        const trainAirFilter = this.ctx.createBiquadFilter();
        trainAirFilter.type = 'bandpass';
        trainAirFilter.frequency.value = 820;
        trainAirFilter.Q.value = 1.6;

        const trainAirGain = this.ctx.createGain();
        trainAirGain.gain.value = 0.020;

        trainAirSource.connect(trainAirFilter);
        trainAirFilter.connect(trainAirGain);
        trainAirGain.connect(this.trainAmbianceGain);
        trainAirSource.start(0);
        this.trainAirSource = trainAirSource;

        // Idling Transformer & Auxiliary Converter drone (100 Hz fundamental + 200 Hz harmonic)
        this.trainIdleOsc1 = this.ctx.createOscillator();
        this.trainIdleOsc1.type = 'sine';
        this.trainIdleOsc1.frequency.value = (this.trainType === 'DT1') ? 50 : 100;

        this.trainIdleOsc2 = this.ctx.createOscillator();
        this.trainIdleOsc2.type = 'triangle';
        this.trainIdleOsc2.frequency.value = (this.trainType === 'DT1') ? 100 : 200;

        const trainIdleGain1 = this.ctx.createGain();
        trainIdleGain1.gain.value = 0.016;

        const trainIdleGain2 = this.ctx.createGain();
        trainIdleGain2.gain.value = 0.008;

        this.trainIdleOsc1.connect(trainIdleGain1);
        this.trainIdleOsc2.connect(trainIdleGain2);
        trainIdleGain1.connect(this.trainAmbianceGain);
        trainIdleGain2.connect(this.trainAmbianceGain);

        this.trainIdleOsc1.start(0);
        this.trainIdleOsc2.start(0);

        this.trainAmbianceGain.connect(this.masterVolume);

        // 2. Constant Station Ambiance Synth:
        // Atmospheric underground acoustic cavern rumble, draft & architectural hall resonance.
        // Fades gracefully when near or at stations.
        this.stationAmbianceGain = this.ctx.createGain();
        this.stationAmbianceGain.gain.value = 0.032;

        const stationNoiseSource = this.ctx.createBufferSource();
        stationNoiseSource.buffer = this.noiseBuffer;
        stationNoiseSource.loop = true;

        // Deep hall bandpass (220 Hz)
        const stationBandpass1 = this.ctx.createBiquadFilter();
        stationBandpass1.type = 'bandpass';
        stationBandpass1.frequency.value = 220;
        stationBandpass1.Q.value = 2.4;

        // Mid-air draft bandpass (600 Hz)
        const stationBandpass2 = this.ctx.createBiquadFilter();
        stationBandpass2.type = 'bandpass';
        stationBandpass2.frequency.value = 600;
        stationBandpass2.Q.value = 1.8;

        const stationGain1 = this.ctx.createGain();
        stationGain1.gain.value = 0.022;

        const stationGain2 = this.ctx.createGain();
        stationGain2.gain.value = 0.014;

        stationNoiseSource.connect(stationBandpass1);
        stationBandpass1.connect(stationGain1);
        stationGain1.connect(this.stationAmbianceGain);

        stationNoiseSource.connect(stationBandpass2);
        stationBandpass2.connect(stationGain2);
        stationGain2.connect(this.stationAmbianceGain);

        stationNoiseSource.start(0);
        this.stationNoiseSource = stationNoiseSource;

        // Cavern room resonance
        this.stationResOsc = this.ctx.createOscillator();
        this.stationResOsc.type = 'sine';
        this.stationResOsc.frequency.value = 75;

        const stationResGain = this.ctx.createGain();
        stationResGain.gain.value = 0.012;

        this.stationResOsc.connect(stationResGain);
        stationResGain.connect(this.stationAmbianceGain);
        this.stationResOsc.start(0);

        this.stationAmbianceGain.connect(this.masterVolume);

        // Send a portion to the reverb node to create depth
        const stationReverbSend = this.ctx.createGain();
        stationReverbSend.gain.value = 0.35;
        this.stationAmbianceGain.connect(stationReverbSend);
        stationReverbSend.connect(this.reverbNode);
    }

    playEscClick(isKlock = false, time) {
        if (!this.initialized || !this.escKlickBuffer) return;
        const now = (typeof time === 'number' && time > 0) ? time : this.ctx.currentTime;
        const src = this.ctx.createBufferSource();
        src.buffer = isKlock ? this.escKlockBuffer : this.escKlickBuffer;
        src.connect(this.escPercGain);
        src.start(now);
    }

    updateEscalatorSound(intensity, dt) {
        if (!this.initialized) return;

        // Smoothly fade master volume based on proximity
        const targetVol = Math.max(0, Math.min(1, intensity)) * 0.42;
        this.escMasterGain.gain.setTargetAtTime(targetVol, this.ctx.currentTime, 0.08);

        if (intensity < 0.01) {
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

    update(speed, throttle, brakePressure, dt, isInside = false, stationDistance = Infinity, isPlatform = false) {
        if (!this.initialized) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();

        const targetReverb = isInside ? 0.45 : 0.05;
        const targetDry = isInside ? 0.75 : 1.0;
        this.reverbGain.gain.setTargetAtTime(targetReverb, this.ctx.currentTime, 0.5);
        this.dryGain.gain.setTargetAtTime(targetDry, this.ctx.currentTime, 0.5);

        const speedKmh = speed * 3.6;
        const isDT1 = this.trainType === 'DT1';
        const isDT3 = this.trainType === 'DT3';

        if (speedKmh > 0.05) {
            // Inverter: DT1 has a low hum, G1 has a characteristic linear sing.
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

                const baseVol = 0.04;
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

                const baseVol = 0.07;
                targetInverterVol = (effort > 0.02 ? effort * baseVol * 2.0 : 0) * this.debugMix.inverter;

                // Fades in between 0 and 2 km/h
                const fadeIn = Math.min(1.0, speedKmh / 2.0);
                targetInverterVol2 = targetInverterVol * 0.5 * fadeIn;
                targetInverterVol3 = targetInverterVol * 0.35 * fadeIn;
            } else {
                // G1: Linear sing between 15 and 80 km/h
                if (this.inverterOsc.type !== 'sawtooth') this.inverterOsc.type = 'sawtooth';

                const isBraking = brakePressure > 0.5 || throttle < -0.05;

                if (isBraking) {
                    if (speedKmh > 20) {
                        // Braking: 1800 Hz at 80 km/h, 1000 Hz at 20 km/h
                        inverterFreq = 1000 + (speedKmh - 20) * (800 / 60);
                    } else {
                        // Jump to 1600 Hz at 20 km/h, stays there until fade out
                        inverterFreq = 1600;
                    }
                } else {
                    // Normal acceleration/rolling: 500 Hz (20 km/h) -> 1000 Hz (80 km/h)
                    inverterFreq = 500 + (speedKmh - 20) * (500 / 60);
                }

                // Volume logic:
                // Acceleration: Fade in 15-20 km/h
                // Braking: Stays audible until 5 km/h
                const fadeIn = isBraking
                    ? Math.max(0, Math.min(1, (speedKmh - 5) / 5))
                    : Math.max(0, Math.min(1, (speedKmh - 15) / 5));

                const fadeOut = Math.max(0, Math.min(1, (80 - speedKmh) / 60));
 
                // Der Sound ab ca. 20 km/h soll etwas lauter sein (von 0.10 auf 0.18 erhöht)
                // Beim Bremsen dezent leiser halten (0.06 statt 0.10)
                const inverterVolMultiplier = isBraking ? 0.06 : 0.18;
                targetInverterVol = (effort > 0.02
                    ? effort * inverterVolMultiplier * fadeIn * fadeOut
                    : 0) * this.debugMix.inverter;
                targetInverterVol2 = 0;
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
                const rumbleVol = effort * 0.08 * Math.min(1.0, speedKmh / 10) * this.debugMix.dt1Rumble;
                this.dt1RumbleGain.gain.setTargetAtTime(rumbleVol, this.ctx.currentTime, 0.2);

                const growlFreq = 40 + speedKmh * 1.5;
                this.dt1GrowlOsc.frequency.setTargetAtTime(growlFreq, this.ctx.currentTime, 0.1);
                const growlVol = effort * 0.05 * Math.min(1.0, speedKmh / 20) * this.debugMix.dt1Growl;
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

        // Startup sing – fades out at 20 km/h (G1 only)
        let startupVolume = 0;
        let sphericalFreq = 75;
        let sphericalVol = 0;

        if (this.trainType === 'G1' && speedKmh > 0.1 && speedKmh < 20.0) {
            if (speedKmh < 3.0) startupVolume = (speedKmh - 0.1) / 2.9;
            else if (speedKmh < 7.0) startupVolume = 1.0;
            else startupVolume = 1.0 - (speedKmh - 7.0) / 13.0;

            // Lautes, hohes Invertersirren (3200 Hz) etwas leiser machen (0.05 -> 0.025)
            startupVolume *= Math.min(1.0, Math.abs(throttle) * 1.5) * 0.025 * this.debugMix.startupSing;

            const lfoSpeed = 6.0 + (speedKmh * 0.85);
            this.startupSingLFO.frequency.setTargetAtTime(lfoSpeed, this.ctx.currentTime, 0.1);

            // Spherical sound logic: Only when accelerating, fade out 10-20 km/h
            const isBraking = brakePressure > 0.5 || throttle < -0.05;
            if (!isBraking && throttle > 0.05) {
                sphericalFreq = 75 + (speedKmh / 20) * 625;
                const sphericalFade = speedKmh < 10 ? 1.0 : Math.max(0, 1 - (speedKmh - 10) / 10);
                sphericalVol = startupVolume * 2.0 * sphericalFade;
            } else {
                sphericalVol = 0;
            }
        }
        this.startupSingGain.gain.setTargetAtTime(startupVolume, this.ctx.currentTime, 0.15);
        this.startupSphericalOsc.frequency.setTargetAtTime(sphericalFreq, this.ctx.currentTime, 0.1);
        this.startupSphericalGain.gain.setTargetAtTime(sphericalVol, this.ctx.currentTime, 0.15);


        // Brake squeal (beim G1 und generell etwas leiser: 0.08 -> 0.04)
        if (speedKmh > 0.5 && speedKmh < 18 && brakePressure > 1.5) {
            const speedFactor = 1 - Math.abs(speedKmh - 6) / 10;
            const brakeBaseVol = (this.trainType === 'G1') ? 0.035 : 0.045;
            const volume = Math.max(0, speedFactor) * (brakePressure / 5) * brakeBaseVol * this.debugMix.brake;
            this.brakeGain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.1);
            // DT1 brake squeal is slightly lower pitched
            const pitch = (isDT1 ? 1400 : 1800) + speedKmh * 80;
            this.brakeOsc.frequency.setTargetAtTime(pitch, this.ctx.currentTime, 0.1);
        } else {
            this.brakeGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
        }

        // --- ROLLGERÄUSCH (Schienen) ---
        if (speedKmh > 0.1) {
            const volCurve = Math.pow(Math.min(speedKmh / VMAX, 1.0), 1.5);

            // DT1 poltert mehr (higher volume, lower cutoff)
            const rollingMultiplier = isDT1 ? 4.5 : 3.0;
            this.rollingGain.gain.setTargetAtTime(volCurve * rollingMultiplier * this.debugMix.rolling, this.ctx.currentTime, 0.2);

            const cutoffMin = isDT1 ? 150 : 200;
            const cutoffMax = isDT1 ? 500 : 600;
            const cutoffFreq = cutoffMin + (cutoffMax - cutoffMin) * (speedKmh / VMAX);
            this.rollingFilter.frequency.setTargetAtTime(cutoffFreq, this.ctx.currentTime, 0.2);
        } else {
            this.rollingGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
        }

        // --- AMBIANCE (Zug & Station) ---
        const ambMult = (this.debugMix && this.debugMix.ambiance !== undefined) ? this.debugMix.ambiance : 1.0;

        // 1. Station Ambiance:
        // Cavernous underground room tone and drafts; increases smoothly when approaching/at station
        if (this.stationAmbianceGain) {
            let targetStationVol = 0.012; // subtle baseline tunnel acoustics
            if (isPlatform || stationDistance < 45) {
                targetStationVol = 0.034; // clear atmospheric station presence
            } else if (stationDistance < 130) {
                const frac = 1.0 - (stationDistance - 45) / 85;
                targetStationVol = 0.012 + 0.022 * frac;
            }
            this.stationAmbianceGain.gain.setTargetAtTime(targetStationVol * ambMult, this.ctx.currentTime, 0.4);
        }

        // 2. Train Ambiance:
        // Always consistent ("immer gleichbleibend"), subtle electrical idling and ventilation presence
        if (this.trainAmbianceGain) {
            const baseTrainVol = isInside ? 0.038 : 0.022;
            this.trainAmbianceGain.gain.setTargetAtTime(baseTrainVol * ambMult, this.ctx.currentTime, 0.3);
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
            const volume = 0.2;
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
            this.playTone(freq, 0.33, 0.12, time, 'sine');
            if (isHigh) {
                // Bei 1000 Hz zusätzlich ein halb so lauter 2000 Hz Ton
                this.playTone(2000, 0.33, 0.06, time, 'sine');
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
        gainNoise.gain.linearRampToValueAtTime(isDT1 ? 0.05 : 0.04, now + 0.15);
        gainNoise.gain.setValueAtTime(isDT1 ? 0.05 : 0.04, now + duration - 0.2);
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
        gainOsc.gain.linearRampToValueAtTime(isDT1 ? 0.025 : 0.03, now + 0.1);
        gainOsc.gain.setValueAtTime(isDT1 ? 0.025 : 0.03, now + duration - 0.15);
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
        oscThump.frequency.exponentialRampToValueAtTime(isDT1 ? 20 : 25, now + 0.5);
        gainThump.gain.setValueAtTime(isDT1 ? 1.5 : 1.2, now);
        gainThump.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        oscThump.connect(gainThump);
        gainThump.connect(this.masterVolume);
        oscThump.start(now);
        oscThump.stop(now + 0.6);

        const oscSub = this.ctx.createOscillator();
        const gainSub = this.ctx.createGain();
        oscSub.type = 'sine';
        oscSub.frequency.setValueAtTime(isDT1 ? 45 : 55, now);
        oscSub.frequency.exponentialRampToValueAtTime(isDT1 ? 15 : 20, now + 0.75);
        gainSub.gain.setValueAtTime(isDT1 ? 2.0 : 1.5, now);
        gainSub.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
        oscSub.connect(gainSub);
        gainSub.connect(this.masterVolume);
        oscSub.start(now);
        oscSub.stop(now + 0.85);

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
        gainNoise.gain.setValueAtTime(isDT1 ? 1.2 : 0.9, now);
        gainNoise.gain.exponentialRampToValueAtTime(0.001, now + (isDT1 ? 0.5 : 0.4));
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
    }

    _playBimmelStrike(time) {
        // Helles, durchdringendes Warnglocken-Bimmeln mit harmonischen Obertönen (halbierte Lautstärke)
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

        // Knackige Anschlag-Hüllkurve (auf Wunsch halb so laut)
        gain1.gain.setValueAtTime(0.0001, time);
        gain1.gain.linearRampToValueAtTime(0.175, time + 0.003);
        gain1.gain.exponentialRampToValueAtTime(0.001, time + 0.090);

        gain2.gain.setValueAtTime(0.0001, time);
        gain2.gain.linearRampToValueAtTime(0.09, time + 0.003);
        gain2.gain.exponentialRampToValueAtTime(0.001, time + 0.075);

        gain3.gain.setValueAtTime(0.0001, time);
        gain3.gain.linearRampToValueAtTime(0.06, time + 0.002);
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
        const now = this.ctx.currentTime;
        const duration = 2.0; // Exakt 2,0 Sekunden durchgehendes Piepen

        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1174.66, now); // D6 (1175 Hz - Standard-Führerstand-Quittungston)

        // Subtiler 2. Oberton für Durchsetzungsfähigkeit auf Handylautsprechern
        const osc2 = this.ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(2349.32, now);

        const gain = this.ctx.createGain();
        const gain2 = this.ctx.createGain();

        // 20ms weicher Attack gegen Knacken (auf Wunsch halb so laut)
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.12, now + 0.02);
        // Solider Haltepegel für 1.95s
        gain.gain.setValueAtTime(0.12, now + 1.96);
        // 40ms weicher Release auf 0 bei genau 2.0s
        gain.gain.linearRampToValueAtTime(0.0001, now + duration);

        gain2.gain.setValueAtTime(0.0001, now);
        gain2.gain.linearRampToValueAtTime(0.03, now + 0.02);
        gain2.gain.setValueAtTime(0.03, now + 1.96);
        gain2.gain.linearRampToValueAtTime(0.0001, now + duration);

        osc.connect(gain);
        osc2.connect(gain2);

        gain.connect(this.masterVolume);
        gain2.connect(this.masterVolume);

        osc.start(now);
        osc2.start(now);

        osc.stop(now + duration + 0.05);
        osc2.stop(now + duration + 0.05);
    }

    setVolume(volume) {
        const vol = Math.max(0, Math.min(1, volume));
        localStorage.setItem('ubahnsim_volume', vol);
        if (this.initialized && this.ctx) {
            this.masterVolume.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.05);
        }
    }
}
