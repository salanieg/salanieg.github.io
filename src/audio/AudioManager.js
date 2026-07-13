/**
 * Web Audio API Sound Synthesizer for Nuremberg Subway Train
 */

const VMAX = 80;

export class AudioManager {
    constructor() {
        this.ctx = null;

        // Nodes
        this.masterVolume = null;
        this.uiVolume = null; // for dry sounds (SIFA, etc.)
        this.reverbNode = null;
        this.reverbGain = null;
        this.dryGain = null;

        // Motor synth nodes
        this.motorOsc1 = null;
        this.motorOsc2 = null;
        this.motorGain = null;
        this.inverterOsc = null;
        this.inverterGain = null;

        // Startup sing nodes
        this.startupSingOsc = null;
        this.startupSingLFO = null;
        this.startupSingLFOGain = null;
        this.startupSingGain = null;

        // Ambient Chord nodes
        this.chordOscs = [];
        this.ambientGain = null;
        this.ambientFilter = null; // lowpass that cuts highs at speed

        // Brake squeal nodes
        this.brakeGain = null;
        this.brakeOsc = null;

        // Nodes für Rollgeräusche
        this.noiseBuffer = null;
        this.rollingNoiseSource = null;
        this.rollingFilter = null;
        this.rollingGain = null;

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
        this.debugMix = {
            motor: 1,
            inverter: 1,
            dt1Rumble: 1,
            dt1Growl: 1,
            startupSing: 1,
            ambient: 1,
            brake: 1,
            rolling: 1
        };
        // Test-Schalter (Sound-Mixer, Taste N): Motor komplett stumm unter 25 km/h
        this.debugMotorMuteBelow25 = false;
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

            // UI volume node (bypasses reverb)
            this.uiVolume = this.ctx.createGain();
            this.uiVolume.gain.value = initialVolume;
            this.uiVolume.connect(this.ctx.destination);

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

            // Setup ambient chord (with lowpass to tame high-speed shriek)
            this.setupAmbientSynth();

            // Setup brake squeal
            this.setupBrakeSynth();

            this.createNoiseBuffer();
            this.setupRollingNoise();

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
        this.motorOsc1 = this.ctx.createOscillator();
        this.motorOsc1.type = 'triangle';
        this.motorOsc1.frequency.value = 0;
        this.motorOsc2 = this.ctx.createOscillator();
        this.motorOsc2.type = 'sine';
        this.motorOsc2.frequency.value = 0;
        this.motorGain = this.ctx.createGain();
        this.motorGain.gain.value = 0;
        this.inverterOsc = this.ctx.createOscillator();
        this.inverterOsc.type = 'sawtooth';
        this.inverterOsc.frequency.value = 100;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1200;
        this.inverterGain = this.ctx.createGain();
        this.inverterGain.gain.value = 0;
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
        this.motorOsc1.connect(this.motorGain);
        this.motorOsc2.connect(this.motorGain);
        this.inverterOsc.connect(filter);
        filter.connect(this.inverterGain);
        this.motorGain.connect(this.masterVolume);
        this.inverterGain.connect(this.masterVolume);
        this.startupSingLFO.connect(this.startupSingLFOGain);
        this.startupSingLFOGain.connect(this.startupSingOsc.frequency);
        this.startupSingOsc.connect(this.startupSingGain);
        this.startupSingGain.connect(this.masterVolume);

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

        this.motorOsc1.start();
        this.motorOsc2.start();
        this.inverterOsc.start();
        this.startupSingOsc.start();
        this.startupSingLFO.start();
    }

    setupAmbientSynth() {
        this.chordOscs = [];
        this.ambientFilter = this.ctx.createBiquadFilter();
        this.ambientFilter.type = 'lowpass';
        this.ambientFilter.frequency.value = 900;
        this.ambientFilter.Q.value = 0.7;
        this.ambientGain = this.ctx.createGain();
        this.ambientGain.gain.value = 0;
        const baseFreqs = [533.3, 666.6, 800];
        baseFreqs.forEach(f => {
            const osc = this.ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = f;
            osc.connect(this.ambientGain);
            osc.start();
            this.chordOscs.push(osc);
        });
        this.ambientGain.connect(this.ambientFilter);
        this.ambientFilter.connect(this.masterVolume);
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
            // Erzeugt "Braunes Rauschen" durch Akkumulation (Tiefpass-Filterung von weißem Rauschen)
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

    update(speed, throttle, brakePressure, dt, isInside = false) {
        if (!this.initialized) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();

        const targetReverb = isInside ? 0.45 : 0.05;
        const targetDry = isInside ? 0.75 : 1.0;
        this.reverbGain.gain.setTargetAtTime(targetReverb, this.ctx.currentTime, 0.5);
        this.dryGain.gain.setTargetAtTime(targetDry, this.ctx.currentTime, 0.5);

        const speedKmh = speed * 3.6;
        const isDT1 = this.trainType === 'DT1';

        // 1. Motor sound - komplett entfernt (Motorhum), Regler bleibt im Sound-Mixer (Taste N) für Tests erhalten
        this.motorGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
        if (speedKmh > 0.5) {

            // Inverter: DT1 has no modern high-pitch inverter sing, but maybe a low hum.
            // G1's inverter sing only starts at 20 km/h, but from there it should sound
            // exactly like the original curve used to sound starting at 0 km/h - so we
            // just feed the original formulas an effective speed shifted by -20.
            const invSpeed = isDT1 ? speedKmh : Math.max(0, speedKmh - 20);
            let inverterFreq = 200;
            if (isDT1) {
                inverterFreq = 100 + invSpeed * 2; // low grumble
            } else {
                if (invSpeed < 25) {
                    inverterFreq = 150 + invSpeed * 22;
                } else if (invSpeed < 50) {
                    inverterFreq = 400 + (invSpeed - 25) * 10;
                } else {
                    inverterFreq = 650 + (invSpeed - 50) * 5;
                }
            }
            this.inverterOsc.frequency.setTargetAtTime(inverterFreq, this.ctx.currentTime, 0.15);

            const inverterRamp = Math.min(1.0, invSpeed / 10);
            const effort = Math.max(Math.abs(throttle), Math.min(1.0, brakePressure / 5));

            // DT1 inverter sound is much quieter/deeper
            const inverterVolMultiplier = isDT1 ? 0.04 : 0.10;
            const inverterCutoff = isDT1 ? 30 : 65;

            const targetInverterVol = (effort > 0.02
                ? effort * inverterVolMultiplier * Math.max(0, 1 - invSpeed / inverterCutoff) * inverterRamp
                : 0) * this.debugMix.inverter;
            this.inverterGain.gain.setTargetAtTime(targetInverterVol, this.ctx.currentTime, 0.1);

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
            this.motorGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
            this.inverterGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
            this.dt1RumbleGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
            this.dt1GrowlGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
        }

        // Startup sing – fades out at 20 km/h (G1 only)
        let startupVolume = 0;
        if (!isDT1 && speedKmh > 0.1 && speedKmh < 20.0) {
            if (speedKmh < 3.0) startupVolume = (speedKmh - 0.1) / 2.9;
            else if (speedKmh < 7.0) startupVolume = 1.0;
            else startupVolume = 1.0 - (speedKmh - 7.0) / 13.0;
            startupVolume *= Math.min(1.0, Math.abs(throttle) * 1.5) * 0.025 * this.debugMix.startupSing;
            const lfoSpeed = 6.0 + (speedKmh * 0.85);
            this.startupSingLFO.frequency.setTargetAtTime(lfoSpeed, this.ctx.currentTime, 0.1);
        }
        this.startupSingGain.gain.setTargetAtTime(startupVolume, this.ctx.currentTime, 0.15);

        // Ambient Chord
        if (speedKmh > 0.1) {
            const clampedSpeed = speedKmh < 40 ? speedKmh : 40 + (speedKmh - 40) * 0.15;
            // DT1 chords could be slightly lower pitched or omitted, but let's keep them for "whine"
            const pitchScale = isDT1 ? 0.8 : 1.0;
            this.chordOscs[0].frequency.setTargetAtTime((13.333 * clampedSpeed + 533.333) * pitchScale, this.ctx.currentTime, 0.5);
            this.chordOscs[1].frequency.setTargetAtTime((16.666 * clampedSpeed + 666.666) * pitchScale, this.ctx.currentTime, 0.5);
            this.chordOscs[2].frequency.setTargetAtTime((20.000 * clampedSpeed + 800.000) * pitchScale, this.ctx.currentTime, 0.5);

            const maxAmbVol = isDT1 ? 0.04 : 0.07; // DT1 whine is less prominent
            const targetAmbVol = (speedKmh < 50
                ? Math.min(maxAmbVol, (speedKmh / 80) * 0.15)
                : Math.max(0, maxAmbVol * (1 - (speedKmh - 50) / 40))) * this.debugMix.ambient;
            this.ambientGain.gain.setTargetAtTime(targetAmbVol, this.ctx.currentTime, 0.4);
            const filterCutoff = Math.max(isDT1 ? 300 : 400, (isDT1 ? 700 : 900) - speedKmh * 6);
            this.ambientFilter.frequency.setTargetAtTime(filterCutoff, this.ctx.currentTime, 0.5);
        } else {
            this.ambientGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.5);
        }

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

        const beepCount = 10;
        const interval = 1 / 3;
        for (let i = 0; i < beepCount; i++) {
            const time = now + i * interval;
            const freq = (i % 2 === 0) ? 500 : 1000;
            this.playTone(freq, 0.33, 0.25, time);
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
        filter.frequency.setValueAtTime(isDT1 ? 1200 : 1000, now);
        const gainNoise = this.ctx.createGain();
        gainNoise.gain.setValueAtTime(0, now);
        gainNoise.gain.linearRampToValueAtTime(isDT1 ? 0.03 : 0.04, now + 0.15);
        gainNoise.gain.setValueAtTime(isDT1 ? 0.03 : 0.04, now + duration - 0.2);
        gainNoise.gain.exponentialRampToValueAtTime(0.001, now + duration);
        noise.connect(filter);
        filter.connect(gainNoise);
        gainNoise.connect(this.masterVolume);
        noise.start(now);
        noise.stop(now + duration);

        const osc = this.ctx.createOscillator();
        const gainOsc = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(isDT1 ? 180 : 220, now);
        osc.frequency.linearRampToValueAtTime(isDT1 ? 200 : 240, now + duration);
        const lfo = this.ctx.createOscillator();
        lfo.frequency.value = isDT1 ? 45 : 35;
        const lfoGain = this.ctx.createGain();
        lfoGain.gain.value = 10;
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        gainOsc.gain.setValueAtTime(0, now);
        gainOsc.gain.linearRampToValueAtTime(isDT1 ? 0.012 : 0.03, now + 0.1);
        gainOsc.gain.setValueAtTime(isDT1 ? 0.012 : 0.03, now + duration - 0.15);
        gainOsc.gain.exponentialRampToValueAtTime(0.001, now + duration);
        osc.connect(gainOsc);
        gainOsc.connect(this.masterVolume);
        lfo.start(now);
        osc.start(now);
        lfo.stop(now + duration);
        osc.stop(now + duration);

        // DT1 metallic rattle: quieter, lower and more rumbling
        if (isDT1) {
            const rattleBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const rattleData = rattleBuffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) rattleData[i] = Math.random() * 2 - 1;
            const rattleNoise = this.ctx.createBufferSource();
            rattleNoise.buffer = rattleBuffer;
            const rattleFilter = this.ctx.createBiquadFilter();
            rattleFilter.type = 'lowpass';
            rattleFilter.frequency.setValueAtTime(900, now);
            rattleFilter.Q.setValueAtTime(0.8, now);
            const rattleGain = this.ctx.createGain();

            // Slower, softer modulation for a more physical rumble
            const rattleLFO = this.ctx.createOscillator();
            rattleLFO.type = 'sine';
            rattleLFO.frequency.setValueAtTime(8, now);
            const rattleLFOGain = this.ctx.createGain();
            rattleLFOGain.gain.setValueAtTime(0.25, now);
            rattleLFO.connect(rattleLFOGain);

            const rattleBaseGain = this.ctx.createGain();
            rattleBaseGain.gain.setValueAtTime(0, now);
            rattleBaseGain.gain.linearRampToValueAtTime(0.05, now + 0.25);
            rattleBaseGain.gain.setValueAtTime(0.05, now + duration - 0.35);
            rattleBaseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

            rattleNoise.connect(rattleFilter);
            rattleFilter.connect(rattleGain);
            rattleGain.connect(rattleBaseGain);
            rattleBaseGain.connect(this.masterVolume);

            rattleLFOGain.connect(rattleGain.gain);

            rattleLFO.start(now);
            rattleNoise.start(now);
            rattleLFO.stop(now + duration);
            rattleNoise.stop(now + duration);

            // Softer, lower-pitched pings
            for (let i = 0; i < 2; i++) {
                const pingTime = now + 0.25 + Math.random() * (duration - 0.45);
                const pingOsc = this.ctx.createOscillator();
                const pingGain = this.ctx.createGain();
                pingOsc.type = 'triangle';
                pingOsc.frequency.setValueAtTime(700 + Math.random() * 300, pingTime);
                pingGain.gain.setValueAtTime(0, pingTime);
                pingGain.gain.linearRampToValueAtTime(0.008, pingTime + 0.01);
                pingGain.gain.exponentialRampToValueAtTime(0.001, pingTime + 0.05);
                pingOsc.connect(pingGain);
                pingGain.connect(this.masterVolume);
                pingOsc.start(pingTime);
                pingOsc.stop(pingTime + 0.06);
            }
        }
    }

    playDoorThud() {
        if (!this.initialized) return;
        const now = this.ctx.currentTime;
        const oscThump = this.ctx.createOscillator();
        const gainThump = this.ctx.createGain();
        oscThump.type = 'triangle';
        oscThump.frequency.setValueAtTime(110, now);
        oscThump.frequency.exponentialRampToValueAtTime(25, now + 0.5);
        gainThump.gain.setValueAtTime(1.2, now);
        gainThump.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        oscThump.connect(gainThump);
        gainThump.connect(this.masterVolume);
        oscThump.start(now);
        oscThump.stop(now + 0.6);
        const oscSub = this.ctx.createOscillator();
        const gainSub = this.ctx.createGain();
        oscSub.type = 'sine';
        oscSub.frequency.setValueAtTime(55, now);
        oscSub.frequency.exponentialRampToValueAtTime(20, now + 0.75);
        gainSub.gain.setValueAtTime(1.5, now);
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
        filter.frequency.setValueAtTime(90, now);
        const gainNoise = this.ctx.createGain();
        gainNoise.gain.setValueAtTime(0.9, now);
        gainNoise.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
        noise.connect(filter);
        filter.connect(gainNoise);
        gainNoise.connect(this.masterVolume);
        noise.start(now);
        noise.stop(now + 0.5);
    }

    playStationChime() {
        if (!this.initialized) return;
        const now = this.ctx.currentTime;
        this.playTone(698.46, 0.4, 0.35, now);
        this.playTone(523.25, 0.6, 0.35, now + 0.35);
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
        const time = this.ctx.currentTime;
        this.hornOsc1 = this.ctx.createOscillator();
        this.hornOsc2 = this.ctx.createOscillator();
        this.hornGain = this.ctx.createGain();
        this.hornOsc1.type = 'sawtooth';
        this.hornOsc1.frequency.setValueAtTime(370, time);
        this.hornOsc2.type = 'sawtooth';
        this.hornOsc2.frequency.setValueAtTime(440, time);
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1500;
        this.hornGain.gain.setValueAtTime(0, time);
        this.hornGain.gain.linearRampToValueAtTime(0.35, time + 0.05);
        this.hornOsc1.connect(filter);
        this.hornOsc2.connect(filter);
        filter.connect(this.hornGain);
        this.hornGain.connect(this.masterVolume);
        this.hornOsc1.start(time);
        this.hornOsc2.start(time);
    }

    stopHorn() {
        if (!this.initialized || !this.hornActive) return;
        const time = this.ctx.currentTime;
        this.hornGain.gain.cancelScheduledValues(time);
        this.hornGain.gain.setValueAtTime(this.hornGain.gain.value, time);
        this.hornGain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
        const osc1 = this.hornOsc1;
        const osc2 = this.hornOsc2;
        setTimeout(() => { try { osc1.stop(); osc2.stop(); } catch(e){} }, 120);
        this.hornActive = false;
    }

    playTone(freq, duration, volume, time) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, time);
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(volume, time + 0.02);
        gain.gain.setValueAtTime(volume, time + duration - 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
        osc.connect(gain);
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
            this.uiVolume.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.05);
        }
    }

    playSifa(active = true) {
        if (!this.initialized) return;
        if (active) {
            if (this.sifaOsc) return;
            this.sifaOsc = this.ctx.createOscillator();
            this.sifaGain = this.ctx.createGain();
            this.sifaOsc.type = 'sine';
            this.sifaOsc.frequency.value = 1450;
            this.sifaGain.gain.value = 0;
            this.sifaGain.gain.linearRampToValueAtTime(0.2, this.ctx.currentTime + 0.05);
            this.sifaOsc.connect(this.sifaGain);
            this.sifaGain.connect(this.uiVolume);
            this.sifaOsc.start();
        } else {
            if (!this.sifaOsc) return;
            const osc = this.sifaOsc;
            const gain = this.sifaGain;
            gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.05);
            setTimeout(() => { try { osc.stop(); } catch(e){} }, 100);
            this.sifaOsc = null;
            this.sifaGain = null;
        }
    }
}