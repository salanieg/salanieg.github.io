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

        // Escalator nodes
        this.escMasterGain = null;
        this.escNoiseGain = null;
        this.escPercGain = null;
        this.escTimer = 0;
        this.escStepIdx = 0; // 0, 1, 2, 3 (Klick, Klick, Klock, Pause)

        this.initialized = false;
        this.footstepBufferNormal = null;
        this.footstepBufferPlatform = null;

        this.trainType = 'G1'; // 'G1' or 'DT1'
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
            rolling: 1
        };
    }

    setTrainType(type) {
        this.trainType = type;
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

            this.dryGain.connect(this.ctx.destination);
            this.reverbGain.connect(this.ctx.destination);

            // Setup motor hum
            this.setupMotorSynth();


            // Setup brake squeal
            this.setupBrakeSynth();

            this.createNoiseBuffer();
            this.setupRollingNoise();

            this.setupEscalatorSynth();

            this.initialized = true;
            this.ctx.resume();

            this.preRenderFootstep(false).then(buffer => {
                this.footstepBufferNormal = buffer;
            }).catch(err => console.error("Error pre-rendering normal footstep:", err));

            this.preRenderFootstep(true).then(buffer => {
                this.footstepBufferPlatform = buffer;
            }).catch(err => console.error("Error pre-rendering platform footstep:", err));
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

        // 1. Dark quiet rush (Noise)
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        noise.loop = true;

        const noiseFilter = this.ctx.createBiquadFilter();
        noiseFilter.type = 'lowpass';
        noiseFilter.frequency.value = 150; // Very dark

        this.escNoiseGain = this.ctx.createGain();
        this.escNoiseGain.gain.value = 0.45; // Base level for the rush

        noise.connect(noiseFilter);
        noiseFilter.connect(this.escNoiseGain);
        this.escNoiseGain.connect(this.escMasterGain);
        noise.start();

        // 2. Rhythmic clicks (Percussion)
        this.escPercGain = this.ctx.createGain();
        this.escPercGain.gain.value = 0.25;
        this.escPercGain.connect(this.escMasterGain);

        this.escMasterGain.connect(this.masterVolume);
    }

    playEscClick(isKlock) {
        if (!this.initialized) return;
        const now = this.ctx.currentTime;

        // 1. Dull Impact (Triangle wave for softer overtones)
        // Physical gain is now identical for all clicks
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(isKlock ? 140 : 220, now);
        osc.frequency.exponentialRampToValueAtTime(1, now + 0.12);

        const impactGain = 1.3;
        gain.gain.setValueAtTime(impactGain, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

        osc.connect(gain);
        gain.connect(this.escPercGain);
        osc.start(now);
        osc.stop(now + 0.12);

        // 2. Heavy Rumbling Thump (Lower frequency sine sweep)
        const thump = this.ctx.createOscillator();
        const thumpGain = this.ctx.createGain();
        thump.type = 'sine';
        thump.frequency.setValueAtTime(isKlock ? 40 : 48, now);
        thump.frequency.exponentialRampToValueAtTime(5, now + 0.18);

        const tGain = 2.0;
        thumpGain.gain.setValueAtTime(tGain, now);
        thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

        thump.connect(thumpGain);
        thumpGain.connect(this.escPercGain);
        thump.start(now);
        thump.stop(now + 0.18);

        // 3. Muffled Mechanical Scuff (Lower Filtered Noise)
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const nFilter = this.ctx.createBiquadFilter();
        nFilter.type = 'lowpass';
        nFilter.frequency.value = isKlock ? 200 : 350;

        const noiseVol = 0.85;
        const nGain = this.ctx.createGain();
        nGain.gain.setValueAtTime(noiseVol, now);
        nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

        noise.connect(nFilter);
        nFilter.connect(nGain);
        nGain.connect(this.escPercGain);
        noise.start(now);
        noise.stop(now + 0.1);
    }

    updateEscalatorSound(intensity, dt) {
        if (!this.initialized) return;

        // Set volume based on proximity (increased multiplier for loudness)
        this.escMasterGain.gain.setTargetAtTime(intensity * 0.45, this.ctx.currentTime, 0.1);

        if (intensity < 0.01) {
            this.escTimer = 0;
            return;
        }

        // Mechanical rhythm cycle (0: Klick, 1: Klick, 2: Klock, 3: Pause)
        // Fixed cycle: 1 second for all 4 beats
        this.escTimer += dt;
        const stepDuration = 0.25;

        if (this.escTimer >= stepDuration) {
            this.escTimer -= stepDuration;

            if (this.escStepIdx === 0) this.playEscClick(false); // Klick
            else if (this.escStepIdx === 1) this.playEscClick(false); // Klick
            else if (this.escStepIdx === 2) this.playEscClick(true); // Klock
            // index 3 is Pause

            this.escStepIdx = (this.escStepIdx + 1) % 4;
        }
    }

    update(speed, throttle, brakePressure, dt, isInside = false) {
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

                const inverterVolMultiplier = 0.10;
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

            // Double the original volume (0.025 -> 0.05)
            startupVolume *= Math.min(1.0, Math.abs(throttle) * 1.5) * 0.05 * this.debugMix.startupSing;

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


        // Brake squeal
        if (speedKmh > 0.5 && speedKmh < 18 && brakePressure > 1.5) {
            const speedFactor = 1 - Math.abs(speedKmh - 6) / 10;
            const volume = Math.max(0, speedFactor) * (brakePressure / 5) * 0.08 * this.debugMix.brake;
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

    preRenderFootstep(isPlatform) {
        return new Promise((resolve, reject) => {
            try {
                const sampleRate = this.ctx.sampleRate;
                const duration = 0.2;
                const length = Math.floor(sampleRate * duration);
                const OfflineAudioContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
                const offlineCtx = new OfflineAudioContextClass(1, length, sampleRate);

                // 1. Thump sweep
                const osc = offlineCtx.createOscillator();
                const gain = offlineCtx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(isPlatform ? 60 : 80, 0);
                osc.frequency.exponentialRampToValueAtTime(isPlatform ? 25 : 30, duration - 0.05);
                gain.gain.setValueAtTime(1.5, 0);
                gain.gain.exponentialRampToValueAtTime(0.001, duration - 0.05);
                osc.connect(gain);
                gain.connect(offlineCtx.destination);

                // 2. Noise scuff
                const noiseSize = Math.floor(sampleRate * 0.1);
                const noiseBuffer = offlineCtx.createBuffer(1, noiseSize, sampleRate);
                const data = noiseBuffer.getChannelData(0);
                for (let i = 0; i < noiseSize; i++) data[i] = Math.random() * 2 - 1;

                const noise = offlineCtx.createBufferSource();
                noise.buffer = noiseBuffer;
                const filter = offlineCtx.createBiquadFilter();
                if (isPlatform) {
                    filter.type = 'lowpass';
                    filter.frequency.setValueAtTime(250, 0);
                } else {
                    filter.type = 'bandpass';
                    filter.frequency.setValueAtTime(800, 0);
                }

                const gainNoise = offlineCtx.createGain();
                gainNoise.gain.setValueAtTime(isPlatform ? 0.35 : 0.7, 0);
                gainNoise.gain.exponentialRampToValueAtTime(0.001, 0.08);

                noise.connect(filter);
                filter.connect(gainNoise);
                gainNoise.connect(offlineCtx.destination);

                osc.start(0);
                osc.stop(duration);
                noise.start(0);
                noise.stop(0.1);

                offlineCtx.startRendering().then(resolve).catch(reject);
            } catch (e) {
                reject(e);
            }
        });
    }

    playFootstep(volume = 0.25, isPlatform = false) {
        if (!this.initialized) return;
        const buffer = isPlatform ? this.footstepBufferPlatform : this.footstepBufferNormal;
        if (!buffer) return;

        const now = this.ctx.currentTime;
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;

        const gainNode = this.ctx.createGain();
        gainNode.gain.setValueAtTime(volume, now);

        source.connect(gainNode);
        gainNode.connect(this.masterVolume);
        source.start(now);
    }

    setVolume(volume) {
        const vol = Math.max(0, Math.min(1, volume));
        localStorage.setItem('ubahnsim_volume', vol);
        if (this.initialized && this.ctx) {
            this.masterVolume.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.05);
        }
    }
}
