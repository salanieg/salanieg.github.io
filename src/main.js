import * as THREE from 'three';
import { Simulation } from './simulator/Simulation.js?v=58';
import { WorldManager } from './simulator/WorldManager.js?v=47';
import { TrackManager } from './simulator/TrackManager.js?v=52';
import { StationModel } from './simulator/StationModel.js?v=49';
import { TrainModel } from './simulator/TrainModel.js?v=66';
import { AudioManager } from './audio/AudioManager.js?v=39';
import { RadioManager } from './audio/RadioManager.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

class App {
    constructor() {
        this.sim = new Simulation();
        this.audio = new AudioManager();
        this.radio = new RadioManager(this.audio);
        this.world = null;
        this.trackManager = null;
        this.stationModel = null;
        this.trainModel = null;
        
        this.clock = new THREE.Clock();
        this.isRunning = false;
        
        // Announcement state
        this.announcedNextStation = false;
        this.lastDoorState = 0;

        // Performance HUD state (toggled with P)
        this.perfHudVisible = false;
        this.perfFrames = 0;
        this.perfTimer = 0;
        
        this.dom = {
            splash: document.getElementById('splash'),
            btnStart: document.getElementById('btn-start')
        };
        
        this.init();
    }

    init() {
        // Build 3D world manager
        const canvasContainer = document.getElementById('canvas3d');
        this.world = new WorldManager(canvasContainer, this.sim);
        
        // Setup Procedural World Builders
        this.trackManager = new TrackManager(this.world.scene, this.sim);
        this.stationModel = new StationModel(this.world.scene, this.sim);
        this.trainModel = new TrainModel(this.world.scene, this.sim);

        // Plärrer reuses the StationModel's floor/stair textures, so build it now.
        this.trackManager.buildPlaerrer(this.stationModel);

        // Load the 3D City model (3Dcity.glb)
        this.loadCityModel();

        // Bind Footsteps from WorldManager to AudioManager
        this.world.onFootstep = (vol) => {
            const isPlatform = this.world.activeCameraType === 'platform';
            this.audio.playFootstep(vol, isPlatform);
        };

        // Bind Start Button
        this.dom.btnStart.addEventListener('click', this.startSimulation.bind(this));

        // Populate Teleport Select Dropdown
        const teleportSelect = document.getElementById('teleport-select');
        this.sim.stations.forEach((station, idx) => {
            const opt = document.createElement('option');
            opt.value = idx;
            opt.textContent = station.name;
            teleportSelect.appendChild(opt);
        });

        // Teleport Button event listener
        document.getElementById('btn-teleport').addEventListener('click', (e) => {
            const val = teleportSelect.value;
            if (val !== "") {
                this.teleportToStation(parseInt(val));
            }
            e.target.blur();
        });

        // Menu Overlay open/close (consolidates Wenden / Steuerung / Zugmodell / Lautstärke)
        const menuOverlay = document.getElementById('menu-overlay');
        document.getElementById('btn-menu').addEventListener('click', (e) => {
            menuOverlay.style.display = 'flex';
            e.target.blur();
        });
        document.getElementById('btn-menu-close').addEventListener('click', (e) => {
            menuOverlay.style.display = 'none';
            e.target.blur();
        });
        menuOverlay.addEventListener('click', (e) => {
            if (e.target === menuOverlay) menuOverlay.style.display = 'none';
        });

        // Wenden Button event listener
        document.getElementById('btn-reverse').addEventListener('click', (e) => {
            if (this.sim.speed < 0.05 && this.sim.doorState === 0 && this.sim.doorProgress === 0) {
                // Find nearest station index based on current train center
                let nearestIdx = 0;
                let minDist = Infinity;
                const trainCenter = this.sim.isReversing ? (this.sim.position + this.sim.trainHalfLength) : (this.sim.position - this.sim.trainHalfLength);

                this.sim.stations.forEach((s, idx) => {
                    const d = Math.abs(trainCenter - s.position);
                    if (d < minDist) {
                        minDist = d;
                        nearestIdx = idx;
                    }
                });

                // Reverse the train direction
                this.sim.reverseTrain();

                // Teleport to the nearest station (handles opposite track and scene update)
                this.teleportToStation(nearestIdx);

                // If in cab view, refresh the camera coordinates for the new leading carriage cockpit
                if (this.world.activeCameraType === 'cab') {
                    this.world.setCamera('cab');
                }
                
                // Play a neutral switch click sound for feedback
                this.audio.playCabSwitch();
            } else {
                alert("Wenden ist nur im Stillstand bei geschlossenen Türen möglich!");
            }
            e.target.blur();
        });

        // Steuerung Button event listener
        document.getElementById('btn-controls').addEventListener('click', (e) => {
            const startBtn = document.getElementById('btn-start');
            startBtn.textContent = "Schließen";
            this.dom.splash.style.display = 'flex';
            e.target.blur();
        });

        // Zugmodell Button event listener
        document.getElementById('btn-model').addEventListener('click', (e) => {
            const nextType = this.sim.trainModelType === 'G1' ? 'DT1' : 'G1';
            this.sim.trainModelType = nextType;
            document.getElementById('btn-model').textContent = `Zugmodell: ${nextType}`;

            // Update audio engine to use specific sounds for DT1
            this.audio.setTrainType(nextType);

            // Rebuild the 3D train model
            this.trainModel.setTrainModel(nextType);
            
            // Update cameras to make sure they are aligned
            if (this.world.activeCameraType === 'cab') {
                this.world.setCamera('cab');
            }
            
            // Play feedback click sound
            this.audio.playCabSwitch();
            e.target.blur();
        });

        // Auflösungs-Button: schaltet die Renderauflösung 100 % -> 75 % -> 50 % durch
        const resBtn = document.getElementById('btn-resolution');
        const resSteps = [1.0, 0.75, 0.5];
        let savedRes = parseFloat(localStorage.getItem('ubahnsim_resscale'));
        if (!resSteps.includes(savedRes)) savedRes = 1.0;
        this.world.setResolutionScale(savedRes);
        const resLabel = (s) => `Auflösung: ${Math.round(s * 100)} %`;
        if (resBtn) {
            resBtn.textContent = resLabel(savedRes);
            resBtn.addEventListener('click', (e) => {
                const next = resSteps[(resSteps.indexOf(this.world.resolutionScale) + 1) % resSteps.length];
                this.world.setResolutionScale(next);
                localStorage.setItem('ubahnsim_resscale', String(next));
                resBtn.textContent = resLabel(next);
                e.target.blur();
            });
        }

        // Setup Volume Slider
        const volumeSlider = document.getElementById('volume-slider');
        const volumeValue = document.getElementById('volume-value');
        const volumeIcon = document.querySelector('.volume-icon');
        
        const savedVolume = localStorage.getItem('ubahnsim_volume');
        const initialVolume = savedVolume !== null ? parseFloat(savedVolume) : 0.6;

        if (volumeSlider) {
            volumeSlider.value = initialVolume;
        }
        if (volumeValue) {
            volumeValue.textContent = `${Math.round(initialVolume * 100)}%`;
        }
        
        const updateVolumeIcon = (vol) => {
            if (!volumeIcon) return;
            if (vol === 0) {
                volumeIcon.textContent = '🔇';
            } else if (vol < 0.3) {
                volumeIcon.textContent = '🔈';
            } else if (vol < 0.6) {
                volumeIcon.textContent = '🔉';
            } else {
                volumeIcon.textContent = '🔊';
            }
        };
        
        updateVolumeIcon(initialVolume);
        
        if (volumeSlider) {
            volumeSlider.addEventListener('input', (e) => {
                const vol = parseFloat(e.target.value);
                if (volumeValue) {
                    volumeValue.textContent = `${Math.round(vol * 100)}%`;
                }
                updateVolumeIcon(vol);
                this.audio.setVolume(vol);
            });
        }
        
        if (volumeIcon) {
            let preMuteVolume = initialVolume;
            volumeIcon.addEventListener('click', () => {
                let currentVol = parseFloat(volumeSlider ? volumeSlider.value : 0.6);
                if (currentVol > 0) {
                    preMuteVolume = currentVol;
                    if (volumeSlider) volumeSlider.value = 0;
                    if (volumeValue) volumeValue.textContent = '0%';
                    volumeIcon.textContent = '🔇';
                    this.audio.setVolume(0);
                } else {
                    const targetVol = preMuteVolume > 0 ? preMuteVolume : 0.6;
                    if (volumeSlider) volumeSlider.value = targetVol;
                    if (volumeValue) volumeValue.textContent = `${Math.round(targetVol * 100)}%`;
                    updateVolumeIcon(targetVol);
                    this.audio.setVolume(targetVol);
                }
            });
        }

        document.getElementById('radio-prev').addEventListener('click', () => {
            this.radio.prevStation();
            this.sim.currentRadioStationIdx = this.radio.currentStationIdx;
            this.sim.radioActive = true;
            document.getElementById('radio-station-name').textContent = this.radio.getStationName();
        });

        document.getElementById('radio-next').addEventListener('click', () => {
            this.radio.nextStation();
            this.sim.currentRadioStationIdx = this.radio.currentStationIdx;
            this.sim.radioActive = true;
            document.getElementById('radio-station-name').textContent = this.radio.getStationName();
        });

        document.getElementById('radio-off').addEventListener('click', () => {
            this.radio.stop();
            this.sim.radioActive = false;
        });

        document.getElementById('radio-close').addEventListener('click', () => {
            this.sim.radioMenuOpen = false;
        });

        // Setup HUD Event Bindings
        this.bindEvents();

        // Setup Mobile Touch Controls
        this.setupMobileControls();

        // Start rendering loop immediately (renders static scene behind splash overlay)
        requestAnimationFrame(this.animate.bind(this));
    }

    loadCityModel() {
        const btnStart = this.dom.btnStart;
        btnStart.disabled = true;
        btnStart.textContent = 'Modell wird geladen...';

        const loadingStatus = document.getElementById('loading-status');
        const loadingBar = document.getElementById('loading-bar');
        const loadingContainer = document.getElementById('loading-container');

        const loader = new GLTFLoader();
        
        loader.load(
            './citynew2.glb',
            (gltf) => {
                const model = gltf.scene;
                
                // Apply the exact position and orientation values determined via debugger
                model.position.set(-5679.00, 0.0, -3779.00);
                model.rotation.set(0, 0, 0);
                model.scale.set(1.0, 1.0, 1.0);
                
                this.world.scene.add(model);
                
                model.traverse(child => {
                    if (child.isMesh) {
                        child.frustumCulled = true;
                        child.castShadow = false;
                        child.receiveShadow = false;
                        if (child.material) {
                            child.material.shadowSide = null;
                        }
                    }
                });

                this.cityModel = model;

                if (loadingContainer) {
                    loadingContainer.style.display = 'none';
                }
                btnStart.disabled = false;
                btnStart.textContent = 'Simulation starten';
                console.log('City model loaded successfully.');
            },
            (xhr) => {
                if (xhr.lengthComputable) {
                    const percentComplete = Math.round((xhr.loaded / xhr.total) * 100);
                    if (loadingStatus) {
                        loadingStatus.textContent = `3D-Stadtmodell wird geladen: ${percentComplete}% (${(xhr.loaded / (1024 * 1024)).toFixed(1)} MB von ${(xhr.total / (1024 * 1024)).toFixed(1)} MB)`;
                    }
                    if (loadingBar) {
                        loadingBar.style.width = percentComplete + '%';
                    }
                } else {
                    const loadedMB = (xhr.loaded / (1024 * 1024)).toFixed(1);
                    if (loadingStatus) {
                        loadingStatus.textContent = `3D-Stadtmodell wird geladen: ${loadedMB} MB geladen...`;
                    }
                    if (loadingBar) {
                        loadingBar.style.width = '50%';
                    }
                }
            },
            (error) => {
                console.error('Error loading city model:', error);
                let errorMsg = 'Netzwerkfehler (404, CORS oder Mime-Type?)';
                if (error && error.message) {
                    errorMsg = error.message;
                } else if (error && error.target && error.target.status) {
                    errorMsg = `HTTP-Fehler ${error.target.status}: ${error.target.statusText || 'Nicht gefunden'}`;
                }
                
                // Check if running directly via file:// protocol
                if (window.location.protocol === 'file:') {
                    errorMsg = 'Browser blockiert lokale Dateien unter file:// (CORS). Bitte nutze einen lokalen Webserver (z.B. Live Server)!';
                }

                if (loadingStatus) {
                    loadingStatus.textContent = `Fehler beim Laden des 3D-Stadtmodells! (${errorMsg})`;
                    loadingStatus.style.color = '#ef4444';
                }
                btnStart.disabled = false;
                btnStart.textContent = 'Simulation starten (ohne Stadt)';
            }
        );
    }

    startSimulation() {
        // Hide splash screen
        this.dom.splash.style.display = 'none';

            // Initialize Audio Context (requires user gesture)
            this.audio.init();

            // Focus container and start loop
            this.isRunning = true;
            this.clock.getDelta(); // reset clock delta
            
            this.audio.playStationChime();
    }

    bindEvents() {
        // 1. Click camera views
        const camButtons = document.querySelectorAll('.camera-hud .cam-btn');
        camButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                camButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.world.setCamera(btn.dataset.cam);
                this.sim.activeCameraType = btn.dataset.cam;
                btn.blur();
            });
        });

        // 2. Keyboard bindings
        document.addEventListener('keydown', (e) => {
            // Performance HUD toggle (works regardless of simulation state)
            if (e.key.toLowerCase() === 'p') {
                this.perfHudVisible = !this.perfHudVisible;
                const hud = document.getElementById('perf-hud');
                if (hud) hud.style.display = this.perfHudVisible ? 'block' : 'none';
                this.perfFrames = 0;
                this.perfTimer = 0;
            }

            if (!this.isRunning) return;

            const key = e.key.toLowerCase();
            const gameKeys = ['w', 's', 'arrowup', 'arrowdown', ' ', 'd', 'f', 'h', 'a', '1', '2', '3', '4'];

            if (gameKeys.includes(key)) {
                e.preventDefault();
                this.sim.resetSifa();
            }

            if (key === 'w' || (e.key === 'ArrowUp' && this.world.activeCameraType !== 'platform' && this.world.activeCameraType !== 'passenger')) {
                // Throttle Up
                if (!this.sim.atoMode) {
                    this.sim.throttle = Math.min(1.0, this.sim.throttle + 0.1);
                }
            } else if (key === 's' || (e.key === 'ArrowDown' && this.world.activeCameraType !== 'platform' && this.world.activeCameraType !== 'passenger')) {
                // Throttle Down (Brake)
                if (!this.sim.atoMode) {
                    this.sim.throttle = Math.max(-1.0, this.sim.throttle - 0.15);
                }
            } else if (key === ' ' || key === 'spacebar') {
                // Emergency Brake
                this.sim.triggerEmergencyBrake();
            } else if (key === 'd') {
                // Doors
                this.handleDoors();
            } else if (key === 'f') {
                // Fahrertür (driver cab door): open only at (near) standstill,
                // closing is always allowed
                if (this.sim.speed < 0.5 || this.trainModel.cabDoorOpen) {
                    this.trainModel.toggleCabDoor();
                }
            } else if (key === 'h') {
                // Horn
                this.audio.playHorn();
            } else if (key === 'a') {
                // ATO Autopilot toggle
                this.sim.atoMode = !this.sim.atoMode;
                this.audio.playAutopilotChime(this.sim.atoMode);
            } else if (key === '1') {
                this.triggerCamBtn('cab');
            } else if (key === '2') {
                this.triggerCamBtn('passenger');
            } else if (key === '3') {
                this.triggerCamBtn('platform');
            } else if (key === '4') {
                this.triggerCamBtn('orbit');
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.key.toLowerCase() === 'h') {
                this.audio.stopHorn();
            }
        });
    }

    setupMobileControls() {
        // Detect touch/smartphone usage: coarse pointer + touch support
        const isMobile = ('ontouchstart' in window || navigator.maxTouchPoints > 0)
            && window.matchMedia('(pointer: coarse)').matches;

        if (isMobile) {
            document.body.classList.add('is-mobile');
        }

        const throttleSlider = document.getElementById('mobile-throttle-slider');
        if (throttleSlider) {
            throttleSlider.addEventListener('input', (e) => {
                if (!this.isRunning) return;
                this.sim.resetSifa();
                if (!this.sim.atoMode) {
                    this.sim.throttle = parseFloat(e.target.value) / 100;
                }
            });
        }

        const doorsBtn = document.getElementById('btn-mobile-doors');
        if (doorsBtn) {
            doorsBtn.addEventListener('click', () => {
                if (!this.isRunning) return;
                this.sim.resetSifa();
                this.handleDoors();
            });
        }
    }

    triggerCamBtn(type) {
        const btn = document.querySelector(`.camera-hud button[data-cam="${type}"]`);
        if (btn) btn.click();
    }

    handleDoors() {
        if (this.sim.speed > 0.05) return; // interlock
        
        const nextStation = this.sim.stations[this.sim.nextStationIdx];
        const trainCenter = this.sim.isReversing ? (this.sim.position + this.sim.trainHalfLength) : (this.sim.position - this.sim.trainHalfLength);
        const distToStation = Math.abs(trainCenter - nextStation.position);
        const isAtPlatform = distToStation < 12;

        if (this.sim.doorState === 0 || this.sim.doorState === 3) {
            // Opening: play chimes only when actually at station platforms
            if (isAtPlatform) {
                setTimeout(() => this.audio.playStationChime(), 100);
            }
            this.sim.triggerDoors();
        } else if (this.sim.doorState === 2 || this.sim.doorState === 1) {
            // Closing: play the door beep warning immediately
            this.sim.doorWarningActive = true;
            this.audio.playDoorWarning();
            setTimeout(() => {
                if (this.sim.doorState === 2 || this.sim.doorState === 1) {
                    this.sim.triggerDoors();
                }
            }, 800);
        }
    }

    animate() {
        requestAnimationFrame(this.animate.bind(this));

        const dt = Math.min(this.clock.getDelta(), 0.1); // cap max delta at 0.1s

        if (this.isRunning) {
            // 1. Physics Engine Update
            this.sim.update(dt);

            // Play door close warning if requested by simulation
            if (this.sim.wantsDoorWarning) {
                this.audio.playDoorWarning();
                this.sim.wantsDoorWarning = false;
            }

            // Play mechanical door sounds on state transitions
            if (this.sim.doorState !== this.lastDoorState) {
                if (this.sim.doorState === 1 && this.lastDoorState !== 1) {
                    // Open triggered (opening): play click and slide (delayed by 150ms)
                    this.audio.playDoorUnlock();
                    this.audio.playDoorSlide(1.25, 0.15);
                } else if (this.sim.doorState === 3 && this.lastDoorState !== 3) {
                    // Close triggered (closing): play slide
                    this.audio.playDoorSlide(1.25);
                } else if (this.sim.doorState === 0 && this.lastDoorState === 3) {
                    // Fully closed: play heavy thud
                    this.audio.playDoorThud();
                }
                this.lastDoorState = this.sim.doorState;
            }

            // 2. Web Audio Synthesis Update
            const isInside = this.world.isCurrentViewReverberant();
            this.audio.update(this.sim.speed, this.sim.throttle, this.sim.brakeCylinderPressure, dt, isInside);


            // 4. Trigger announcements
            this.handleAnnouncements();

            // Immediate Radio Activation Signal
            if (this.sim.wantsRadioPlay) {
                this.radio.play();
                this.sim.radioActive = true;
                this.sim.wantsRadioPlay = false;
            }
        }

        // Update Radio UI
        const radioPopup = document.getElementById('radio-popup');
        if (radioPopup) {
            radioPopup.style.display = this.sim.radioMenuOpen ? 'block' : 'none';
            if (this.sim.radioMenuOpen) {
                document.getElementById('radio-station-name').textContent = this.radio.getStationName();
            }
        }

        // Always update 3D scene
        this.trackManager.update(this.sim.position);
        this.stationModel.update(this.sim.position);
        this.trainModel.update(dt);
        this.world.update(dt, this.trainModel);

        // Performance HUD (Taste P): FPS + Renderer-Statistiken, 2x pro Sekunde aktualisiert
        if (this.perfHudVisible) {
            this.perfFrames++;
            this.perfTimer += dt;
            if (this.perfTimer >= 0.5) {
                const fps = this.perfFrames / this.perfTimer;
                const info = this.world.renderer.info;
                const hud = document.getElementById('perf-hud');
                if (hud) {
                    hud.textContent =
                        `FPS:        ${fps.toFixed(0)} (${(1000 / fps).toFixed(1)} ms)\n` +
                        `Draw Calls: ${info.render.calls}\n` +
                        `Dreiecke:   ${info.render.triangles.toLocaleString('de-DE')}\n` +
                        `Geometrien: ${info.memory.geometries}  Texturen: ${info.memory.textures}`;
                }
                this.perfFrames = 0;
                this.perfTimer = 0;
            }
        }
    }

    handleAnnouncements() {
        const nextStation = this.sim.stations[this.sim.nextStationIdx];
        const trainCenter = this.sim.isReversing ? (this.sim.position + this.sim.trainHalfLength) : (this.sim.position - this.sim.trainHalfLength);
        const distToStation = Math.abs(trainCenter - nextStation.position);

        // Announce when train is 220 meters before station platform center
        if (distToStation < 220 && distToStation > 180 && !this.announcedNextStation && this.sim.speed > 5) {
            this.audio.playStationChime();
            this.announcedNextStation = true;
        }

        // Reset announcement flag once stopped at platform center
        if (this.sim.speed < 0.05 && distToStation < 5) {
            this.announcedNextStation = false;
        }
    }

    teleportToStation(stationIdx) {
        const station = this.sim.stations[stationIdx];
        if (!station) return;

        // Reset speed and control inputs
        this.sim.speed = 0;
        this.sim.acceleration = 0;
        this.sim.throttle = -0.5; // Apply holding brakes
        this.sim.brakeCylinderPressure = 2.25; // Matching the holding brake pressure
        this.sim.emergencyBrake = false;

        // Reset door status
        this.sim.doorsOpen = false;
        this.sim.doorState = 0; // closed
        this.sim.doorProgress = 0;
        this.sim.doorWarningActive = false;

        // Teleport position to the station platform center (offset by trainHalfLength to center the train)
        this.sim.position = station.position + (this.sim.isReversing ? -this.sim.trainHalfLength : this.sim.trainHalfLength);

        // Set correct current and next station indexes
        this.sim.nextStationIdx = stationIdx;
        if (this.sim.isReversing) {
            this.sim.currentStationIdx = Math.min(this.sim.stations.length - 1, stationIdx + 1);
        } else {
            this.sim.currentStationIdx = Math.max(0, stationIdx - 1);
        }

        // Update displays to show the new station immediately
        this.sim.displayNextStationIdx = stationIdx;
        this.sim.pendingDisplayAdvance = false;

        // Reset timers and announcement flags
        this.sim.stopWaitTime = 0;
        this.announcedNextStation = false;

        // Force update 3D meshes immediately
        this.trackManager.update(this.sim.position);
        this.stationModel.update(this.sim.position);
        this.trainModel.update(0);
        this.world.update(0, this.trainModel);

        // If orbit camera is active, update orbit controls target
        if (this.world.activeCameraType === 'orbit') {
            const centerCar = this.trainModel.carriages[1];
            this.world.controls.target.copy(centerCar.localToWorld(new THREE.Vector3(0, 1.8, -9.5)));
            this.world.controls.update();
        } else if (this.world.activeCameraType === 'platform') {
            // For platform view, re-initialize coordinates for the new station
            this.world.setCamera('platform');
        }
    }
}

// Instantiate App
window.addEventListener('DOMContentLoaded', () => {
    new App();
});
