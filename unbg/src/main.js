// ============================================================================
// main.js — App-Einstieg: verdrahtet UI, Eingaben, Audio und die Linien-Rigs
// (Simulation/TrackManager/StationModel/TrainModel je Linie) und treibt den
// Frame-Loop (animate).
//
// KI-LANDKARTE (wo bearbeite ich was):
//   - Ladevorgang/Ladebalken: startCityModelDownload() (GLB-Download, läuft
//     parallel ab init()) + startLoadingPipeline() (echte Bauschritte treiben
//     den Balken, zeitbudgetiert pro rAF-Tick) -> finishAfterCityModel()
//     (wartet ggf. auf den Download) -> warmUpSpawn() (GPU-Upload NUR der
//     Spawn-Umgebung hinter dem Splash). Der Rest der Linie wird danach im
//     Hintergrund während des Spielens nachgeladen: _beginBackgroundResidency
//     + _residencyPrep/_residencyFinish (pro Frame ein kleiner Batch, das der
//     Zugposition nächste Ziel zuerst); Teleport -> _ensureResidentNow.
//   - Linien-Verwaltung: buildLineRig/adoptRig/switchLine. Genau EINE Linie
//     ist aktiv; this.sim/trackManager/stationModel/trainModel sind Aliase
//     auf das aktive Rig. Geteilte Bauten (Plärrer-Halle, Stammstrecke,
//     Weichen) leben dauerhaft in der Welt-Szene.
//   - Frame-Loop: animate() — Physik, Sounds, Kulling-Updates, Render.
//   - Tastatur/HUDs: bindEvents (W/S/D/F/H/A/Leertaste/1-4; Debug-HUDs:
//     O=Performance, P=Glas-Tuning, C=Stadtmodell, N=Sound-Mixer).
//   - Mobile: setupMobileControls (Slider, Joystick, Buttons).
//   - Cache-Busting: die ?v=-Nummern unten bei JEDER Änderung der jeweiligen
//     Datei erhöhen (und modulübergreifend identisch halten!).
// ============================================================================
import * as THREE from 'three';
import { Simulation } from './simulator/Simulation.js?v=67';
import { WorldManager } from './simulator/WorldManager.js?v=74';
import { TrackManager } from './simulator/TrackManager.js?v=79';
import { StationModel } from './simulator/StationModel.js?v=98';
import { TrainModel } from './simulator/TrainModel.js?v=99';
import { TRACK_DATA_U2 } from './simulator/TrackDataU2.js?v=11';
import { TRACK_DATA_U3 } from './simulator/TrackDataU3.js?v=11';
import { TRACK_DATA_TRUNK } from './simulator/TrackDataTrunk.js?v=5';
import { AudioManager } from './audio/AudioManager.js?v=49';
import { RadioManager } from './audio/RadioManager.js?v=2';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { SpaceIntro } from './simulator/SpaceIntro.js?v=2';

// Wiederverwendbare Temp-Vektoren für den Frame-Loop (kein GC-Druck)
const _escPlayerPos = new THREE.Vector3();

class App {
    constructor() {
        // Line rigs (Simulation/TrackManager/StationModel/TrainModel per line, U1/U2/U3) are
        // built lazily in buildLineRig() -- see init(). Exactly one line is "active" at a
        // time; this.sim/trackManager/stationModel/trainModel always alias the active rig's
        // instances, so the rest of the app (keyboard input, teleport, camera, animate())
        // keeps working unchanged regardless of which line is currently selected.
        this.lineRigs = {};
        this.activeLineId = 'U1';
        this.sim = null;
        this.audio = new AudioManager();
        this.radio = new RadioManager(this.audio);
        this.world = null;
        this.trackManager = null;
        this.stationModel = null;
        this.trainModel = null;

        this.clock = new THREE.Clock();
        this.isRunning = false;

        // Türzustand des letzten Frames (für die Tür-Soundtrigger in animate)
        this.lastDoorState = 0;

        // Performance HUD state (Taste O)
        this.perfHudVisible = false;
        this.perfFrames = 0;
        this.perfTimer = 0;

        // Rolltreppen-Ambience: Positions-Cache (alle 0.5 s aufgefrischt statt
        // die komplette Szene pro Frame zu traversieren)
        this._escalatorCache = [];
        this._escalatorTimer = 0;

        // City model placement debug HUD state (toggled with C)
        this.cityDebugVisible = false;
        this.cityDebugBuilt = false;

        // Forces the in-cab radio display to redraw the first time it's checked
        this.lastRadioDisplayKey = null;

        this.dom = {
            splash: document.getElementById('splash'),
            btnSplashClose: document.getElementById('btn-splash-close'),
            btnSplashDismiss: document.getElementById('btn-splash-dismiss'),
            introStatusContainer: document.getElementById('intro-status-container'),
            introLoadingStatus: document.getElementById('intro-loading-status'),
            btnPlayGame: document.getElementById('btn-play-game')
        };
        this.isSpaceIntro = true;
        this.isReadyToStart = false;
        this._isTransitioning = false;
        
        this.init();
    }

    init() {
        // Build 3D world manager (WorldManager owns the renderer/canvas/cameras)
        const canvasContainer = document.getElementById('canvas3d');
        this.world = new WorldManager(canvasContainer, null);

        // Instant Space Intro: Starfield particle system and cosmic lighting
        this.spaceIntro = new SpaceIntro(this.world.scene, this.world.activeCamera);
        this.world.isSpaceIntro = true;

        // Instant G1 TrainModel in the space scene (isolated in trainRoot)
        const sim = this.getOrCreateSim('U1');
        this.trainRoot = new THREE.Group();
        this.trainRoot.name = 'trainRoot';
        this.world.scene.add(this.trainRoot);

        // Separate lineRoot for subway tracks & stations (strictly hidden during space intro)
        const lineRoot = new THREE.Group();
        lineRoot.name = 'lineRoot_U1';
        lineRoot.visible = false;
        this.world.scene.add(lineRoot);
        this.lineRoot = lineRoot;
        this._loadCtx = { sim, lineRoot };

        this.trainModel = new TrainModel(this.trainRoot, sim);
        this.trainModel.isStraight = true;
        this.trainModel.alignStraight();
        this.sim = sim;
        this.world.sim = sim;
        this.world.train3D = this.trainModel;
        this.world.setCamera('cab');

        // Setup dismissable Steuerung modal (for in-game controls menu)
        const hideControls = () => {
            if (this.dom.splash) this.dom.splash.style.display = 'none';
        };
        if (this.dom.btnSplashClose) this.dom.btnSplashClose.addEventListener('click', hideControls);
        if (this.dom.btnSplashDismiss) this.dom.btnSplashDismiss.addEventListener('click', hideControls);
        if (this.dom.splash) {
            this.dom.splash.addEventListener('click', (e) => {
                if (e.target === this.dom.splash) hideControls();
            });
        }

        // Bind Play Game handler
        if (this.dom.btnPlayGame) this.dom.btnPlayGame.addEventListener('click', () => this.launchGame());

        // Bind Footsteps from WorldManager to AudioManager
        this.world.onFootstep = (vol) => {
            this.audio.playFootstep(vol);
        };

        // Start render loop immediately on Frame 1!
        requestAnimationFrame(this.animate.bind(this));

        // Start background downloads & building
        this.startCityModelDownload();
        this.startBackgroundLoadingPipeline();

        // (Das Teleport-Dropdown wird von der Lade-Pipeline befüllt, sobald das
        // aktive Rig existiert — siehe Schritt 'AKTIVIERE SZENE'.)

        // Teleport Button event listener
        const teleportSelect = document.getElementById('teleport-select');
        document.getElementById('btn-teleport').addEventListener('click', (e) => {
            const val = teleportSelect.value;
            if (val !== "") {
                this.teleportToStation(parseInt(val));
            }
            e.target.blur();
        });

        // Mobile Teleport HUD: single "Teleport" button revealing a station list
        const teleportMobileList = document.getElementById('teleport-mobile-list');
        const teleportMobileBtn = document.getElementById('btn-teleport-mobile');
        if (teleportMobileBtn && teleportMobileList) {
            teleportMobileBtn.addEventListener('click', (e) => {
                teleportMobileList.classList.toggle('open');
                e.target.blur();
            });
        }

        // Mobile Camera HUD: single button cycling through the four camera views
        const camMobileBtn = document.getElementById('btn-cam-mobile');
        const camOrder = ['cab', 'passenger', 'platform', 'orbit'];
        const camLabels = { cab: 'Cockpit', passenger: 'Fahrgast', platform: 'Bahnsteig', orbit: 'Außen' };
        this.updateCamMobileLabel = () => {
            if (camMobileBtn) camMobileBtn.textContent = camLabels[this.world.activeCameraType] || 'Kamera';
        };
        if (camMobileBtn) {
            camMobileBtn.addEventListener('click', (e) => {
                const idx = camOrder.indexOf(this.world.activeCameraType);
                const next = camOrder[(idx + 1) % camOrder.length];
                this.triggerCamBtn(next);
                this.updateCamMobileLabel();
                e.target.blur();
            });
        }

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
            if (this.dom.splash) this.dom.splash.style.display = 'flex';
            e.target.blur();
        });

        // Zugmodell Buttons: GT / DT1 / DT3 — gleiche Logik wie Linien-Buttons
        const modelBtns = {
            G1:  document.getElementById('btn-model-gt'),
            DT1: document.getElementById('btn-model-dt1'),
            DT3: document.getElementById('btn-model-dt3'),
        };
        this.updateModelBtnUI = () => {
            for (const [id, btn] of Object.entries(modelBtns)) {
                if (btn) btn.classList.toggle('active', id === this.sim.trainModelType);
            }
        };
        for (const [modelId, btn] of Object.entries(modelBtns)) {
            if (btn) {
                btn.addEventListener('click', (e) => {
                    if (this.sim.trainModelType === modelId) { e.target.blur(); return; }
                    this.sim.trainModelType = modelId;

                    // Update audio engine to use specific sounds for the chosen model
                    this.audio.setTrainType(modelId);

                    // Rebuild the 3D train model
                    this.trainModel.setTrainModel(modelId);

                    if (this.isSpaceIntro) {
                        this.trainModel.isStraight = true;
                        this.trainModel.alignStraight();
                        this.trainModel.updateLights(false);
                    } else {
                        // Upload the freshly built model to the GPU in this frame
                        this.warmUpRenderer();
                    }

                    // Update cameras to make sure they are aligned
                    if (this.world.activeCameraType === 'cab') {
                        this.world.setCamera('cab');
                    }
                    this.world.update(0.016, this.trainModel);

                    // Play feedback click sound
                    this.audio.playCabSwitch();

                    this.updateModelBtnUI();
                    e.target.blur();
                });
            }
        }


        // Linie Buttons: U1 / U2 / U3 — direkt anklickbar, aktive Linie hervorgehoben
        const lineBtns = {
            U1: document.getElementById('btn-line-u1'),
            U2: document.getElementById('btn-line-u2'),
            U3: document.getElementById('btn-line-u3'),
        };
        this.updateLineBtnUI = () => {
            for (const [id, btn] of Object.entries(lineBtns)) {
                if (btn) btn.classList.toggle('active', id === this.activeLineId);
            }
        };
        for (const [lineId, btn] of Object.entries(lineBtns)) {
            if (btn) {
                btn.addEventListener('click', (e) => {
                    this.switchLine(lineId);
                    this.updateLineBtnUI();
                    e.target.blur();
                });
            }
        }

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

        // Setup HUD Event Bindings
        this.bindEvents();

        // Setup Mobile Touch Controls
        this.setupMobileControls();

        // Der Render-Loop wird am Ende der Lade-Pipeline gestartet
        // (Schritt 'AKTIVIERE SZENE'), sobald das aktive Rig existiert.
    }

    // Builds a fresh, self-contained {sim, trackManager, stationModel, trainModel} rig for one
    // line, parented under its own lineRoot group so the whole line can be shown/hidden with a
    // single .visible toggle when switching. TrackManager/StationModel/TrainModel only ever
    // call scene.add(...) on whatever "scene" they were constructed with, so handing them a
    // THREE.Group instead of the real THREE.Scene works transparently (Object3D duck-typing).
    // Simulation is cheap (arc-length math only, no meshes) but each line's rig is otherwise
    // lazily built on first selection. The bespoke switch-transition pieces need working U2/U3
    // Simulations at init() time regardless, so this cache lets buildLineRig() and init() share
    // the same instance instead of constructing two.
    getOrCreateSim(lineId) {
        if (!this._simCache) this._simCache = {};
        if (!this._simCache[lineId]) {
            const trackDataByLine = { U2: TRACK_DATA_U2, U3: TRACK_DATA_U3 };
            const sim = trackDataByLine[lineId] ? new Simulation(trackDataByLine[lineId]) : new Simulation();
            sim.onEmergencyBrakeChange = (isActive) => {
                if (this.audio) {
                    if (isActive) {
                        this.audio.playEmergencyBrakeAlarm();
                    } else {
                        this.audio.playEmergencyBrakeRelease();
                    }
                }
            };
            this._simCache[lineId] = sim;
        }
        return this._simCache[lineId];
    }

    buildLineRig(lineId) {
        const sim = this.getOrCreateSim(lineId);
        const lineRoot = new THREE.Group();
        lineRoot.name = `lineRoot_${lineId}`;
        this.world.scene.add(lineRoot);
        const trackManager = new TrackManager(lineRoot, sim);
        const stationModel = new StationModel(lineRoot, sim);
        const trainModel = new TrainModel(lineRoot, sim);
        if (lineId !== 'U1') {
            // U2/U3 lines run the automated DT3 train.
            sim.trainModelType = 'DT3';
            trainModel.setTrainModel('DT3');
        }
        // Every line stops at the shared bespoke Plärrer hall (U1: Gleis 1/2, U2/U3 ride
        // the Gleis 3/4 corridor). Hand each rig the permanent group so its own update()
        // can distance-cull it against ITS Plärrer arc position. (For the initial U1 rig
        // this.plaerrerGroup doesn't exist yet -- buildPlaerrer assigns it right after.)
        if (this.plaerrerGroup) trackManager.plaerrerGroup = this.plaerrerGroup;
        return { lineId, sim, trackManager, stationModel, trainModel, lineRoot };
    }

    // (Die Stammstrecke Rothenburger Straße..Rathenauplatz wird als eigener
    // Simulation/TrackManager/StationModel-Verbund — lineId "TRUNK", nie
    // befahren, ohne Zug — EINMAL von der Lade-Pipeline gebaut und dauerhaft
    // in die Welt-Szene gehängt, genau wie die Plärrer-Halle. U2/U3 lassen
    // diesen Bogenlängen-Bereich in ihren eigenen Rigs aus; siehe
    // Simulation.isTrunkZone und die Schritte 'BAUE STAMMSTRECKE' unten.)

    // Distance-cull the whole shared trunk group against the ACTIVE line's own train position,
    // same idiom as TrackManager's internal plaerrerGroup toggle. Only U2/U3 ever have a
    // trunkZone (Simulation.isTrunkZone returns false / trunkZone is null for U1, which never
    // runs through this corridor), so U1 always keeps it hidden.
    updateTrunkVisibility() {
        if (!this.trunkGroup) return;
        const zone = this.sim.trunkZone;
        const pz = this.sim.plaerrer;
        const nearPlaerrer = pz && this.sim.position >= pz.position - 600 && this.sim.position <= pz.position + 600;
        this.trunkGroup.visible = (!!zone && this.sim.position >= zone[0] - 600 && this.sim.position <= zone[1] + 600) || nearPlaerrer;
    }

    // Same idiom, per switch-transition piece (each is keyed by station name so it lines up
    // with this.sim.switchZones, which the ACTIVE line's own Simulation computes for itself).
    // Iterates over the GROUPS (not the zones): a line without switchZones (U1) must hide
    // every piece, otherwise a piece left visible by the previously active line lingers.
    updateSwitchVisibility() {
        if (!this.switchGroups) return;
        const zones = this.sim.switchZones || [];
        for (const [name, g] of Object.entries(this.switchGroups)) {
            const z = zones.find(zn => zn.name === name);
            g.visible = !!z && this.sim.position >= z.range[0] - 600 && this.sim.position <= z.range[1] + 600;
        }
    }

    // Points this.sim/trackManager/stationModel/trainModel (and WorldManager's own sim
    // reference) at the given rig's instances. Every other method in this file reads through
    // these aliases, so nothing else needs to know a line switch happened.
    adoptRig(rig) {
        this.activeLineId = rig.lineId;
        this.sim = rig.sim;
        this.trackManager = rig.trackManager;
        this.stationModel = rig.stationModel;
        this.trainModel = rig.trainModel;
        this.world.sim = rig.sim;

        if (this.stationModel && this.world) {
            this.stationModel.onPassengerVisibility = (passengers, active) => {
                this.world.setPassengersActive(passengers, active);
            };
            for (const idx of this.stationModel.loadedStations.keys()) {
                this.world.setPassengersActive(this.stationModel.stationPassengers.get(idx), true);
            }
        }

        if (this.cityModel && this.world && this.sim) {
            this.world.cityModel = this.cityModel;
            const isUnderground = (this.world.getChunkTypeAtDistance(this.sim.position) === 'underground');
            this.cityModel.visible = !isUnderground;
        }
    }

    switchLine(lineId) {
        if (lineId === this.activeLineId) return;
        if (!this.lineRigs[lineId]) {
            this.lineRigs[lineId] = this.buildLineRig(lineId);
        }
        this.lineRigs[this.activeLineId].lineRoot.visible = false;
        this.lineRigs[lineId].lineRoot.visible = true;
        this.adoptRig(this.lineRigs[lineId]);

        // Tür-Sound-Zustand gehört zum jetzt aktiven Zug
        this.lastDoorState = 0;

        this.rebuildTeleportUI();
        this.audio.setTrainType(this.trainModel.trainType);

        // Update the model buttons to reflect this line's current model,
        // defaulting to G1 on U1 and DT3 on U2/U3 for freshly built rigs.
        if (!this.sim.trainModelType) {
            this.sim.trainModelType = (lineId === 'U1' ? 'G1' : 'DT3');
        }
        if (this.updateModelBtnUI) this.updateModelBtnUI();


        // Snap geometry/camera to the resumed train position, same as the G1<->DT1 rebuild.
        this.trackManager.update(this.sim.position);
        this.updateTrunkVisibility();
        this.updateSwitchVisibility();
        this.stationModel.update(this.sim.position);
        this.trainModel.update(0);
        this.world.update(0, this.trainModel);
        this.warmUpRenderer();

        // Hintergrund-Residency auf die neue Linie umstellen (Chunk-/Stations-
        // Indizes gelten pro Linie): frisch aufsetzen, damit der Rest DIESER
        // Linie nachgeladen wird. Bereits residente Geometrie erzeugt beim
        // erneuten Warmlauf keinen Upload mehr (die Buffer bleiben auf der GPU).
        this._resChunks = new Set();
        this._resStations = new Set();
        this._seedResidencyFromLiveScene();
        this._beginBackgroundResidency();

        if (this.world.activeCameraType === 'cab') this.world.setCamera('cab');
        if (this.world.activeCameraType === 'platform') this.world.setCamera('platform');
        this.audio.playCabSwitch();
    }

    // (Re)populates the teleport <select> and the mobile teleport button list from the
    // currently active line's station list. The desktop <select> keeps its static disabled
    // placeholder <option> (index.html) and only the real per-station options are rebuilt.
    rebuildTeleportUI() {
        const teleportSelect = document.getElementById('teleport-select');
        if (teleportSelect) {
            while (teleportSelect.options.length > 1) teleportSelect.remove(1);
            this.sim.stations.forEach((station, idx) => {
                const opt = document.createElement('option');
                opt.value = idx;
                opt.textContent = station.name;
                teleportSelect.appendChild(opt);
            });
            teleportSelect.value = "";
        }

        const teleportMobileList = document.getElementById('teleport-mobile-list');
        if (teleportMobileList) {
            teleportMobileList.innerHTML = '';
            this.sim.stations.forEach((station, idx) => {
                const btn = document.createElement('button');
                btn.textContent = station.name;
                btn.addEventListener('click', () => {
                    this.teleportToStation(idx);
                    teleportMobileList.classList.remove('open');
                });
                teleportMobileList.appendChild(btn);
            });
        }
    }

    // ------------------------------------------------------------------------
    // Ehrliche Lade-Pipeline: der Balken wird von den ECHTEN Bauschritten
    // getrieben (früher lief hier eine reine 1-Sekunden-Attrappe "LADE
    // TEXTUREN"). Jeder Schritt läuft in einem eigenen requestAnimationFrame-
    // Tick, damit der Browser zwischen den Schritten Text/Balken neu zeichnet.
    // `weight` = grobe relative Dauer des Schritts (bestimmt den Balken-Anteil);
    // `tick()` wird pro Frame aufgerufen und liefert den Fortschritt 0..1 —
    // mehrteilige Schritte (Stationen, Chunks) kommen so pro Frame ein Stück
    // voran, statt die Seite sekundenlang einzufrieren.
    // Aufteilung des Balkens: Bauschritte 0..72 %, Stadtmodell-Download
    // 72..97 % (echter XHR-Fortschritt), GPU-Upload 97..100 %.
    // ------------------------------------------------------------------------
    // Hintergrund-Lade-Pipeline:
    // Die Strecke, Bahnhöfe, Stammstrecke, Weichen, Stadtmodell und GPU-Shader
    // werden asynchron im Hintergrund geladen, während der Spieler im Cockpit
    // bereits das schwebende Sternenfeld genießt.
    // ------------------------------------------------------------------------
    startBackgroundLoadingPipeline() {
        const steps = [
            () => {
                this._loadCtx.trackManager = new TrackManager(this._loadCtx.lineRoot, this._loadCtx.sim);
            },
            () => {
                this._loadCtx.stationModel = new StationModel(this._loadCtx.lineRoot, this._loadCtx.sim, { deferBuild: true });
            },
            () => {
                if (this._loadCtx.stationModel) this._loadCtx.stationModel.buildStationAtIndex(0);
            },
            () => {
                if (this._loadCtx.stationModel) this._loadCtx.stationModel.buildStationAtIndex(1);
            },
            () => {
                const ctx = this._loadCtx;
                const rig = {
                    lineId: 'U1', sim: ctx.sim, trackManager: ctx.trackManager,
                    stationModel: ctx.stationModel, trainModel: this.trainModel, lineRoot: ctx.lineRoot
                };
                this.lineRigs.U1 = rig;
                this.adoptRig(rig);
            },
            () => {
                this.plaerrerGroup = this._loadCtx.trackManager.buildPlaerrer(this._loadCtx.stationModel);
                if (this.plaerrerGroup) {
                    this.plaerrerGroup.visible = false;
                    this.world.scene.add(this.plaerrerGroup);
                }
            },
            () => {
                const sim = new Simulation(TRACK_DATA_TRUNK);
                const root = new THREE.Group();
                root.name = 'trunkRoot';
                root.visible = false;
                this._trunkCtx = {
                    sim, root,
                    trackManager: new TrackManager(root, sim),
                    stationModel: new StationModel(root, sim, { deferBuild: true })
                };
                this._trunkSim = sim;
                this._trunkStationModel = this._trunkCtx.stationModel;
                this.trunkGroup = root;
                this.world.scene.add(root);
            },
            () => {
                const u2Sim = this.getOrCreateSim('U2'), u3Sim = this.getOrCreateSim('U3');
                this.switchGroups = {};
                for (const name of ['Rothenburger Straße', 'Rathenauplatz']) {
                    const g = this._loadCtx.trackManager.buildSwitchTransition(u2Sim, u3Sim, name, name);
                    if (g) { g.visible = false; this.switchGroups[name] = g; this.world.scene.add(g); }
                }
            },
            () => {
                this.rebuildTeleportUI();
            }
        ];

        let idx = 0;
        const pump = () => {
            const startT = performance.now();
            while (idx < steps.length && (performance.now() - startT < 10)) {
                try {
                    steps[idx]();
                } catch (err) {
                    console.error('Error in background loading step', idx, err);
                }
                idx++;
                this._loadPipelineStepIdx = idx;
            }
            if (idx < steps.length) {
                requestAnimationFrame(pump);
            } else {
                // Initial rigs are built! Start residency for ALL remaining chunks and stations!
                this._seedResidencyFromLiveScene();
                this._beginBackgroundResidency();
            }
        };
        requestAnimationFrame(pump);
    }

    onBackgroundLoadingComplete() {
        this.isReadyToStart = true;
        console.log('Background loading complete! 100% of all chunks & stations are on GPU. "Spiel starten!" is ready.');

        if (this.dom.introLoadingStatus) {
            this.dom.introLoadingStatus.textContent = '100 % geladen';
            setTimeout(() => {
                if (this.dom.introLoadingStatus) this.dom.introLoadingStatus.style.display = 'none';
                if (this.dom.btnPlayGame) {
                    this.dom.btnPlayGame.style.display = 'inline-flex';
                    this.dom.btnPlayGame.style.opacity = '0';
                    requestAnimationFrame(() => {
                        this.dom.btnPlayGame.style.opacity = '1';
                    });
                }
            }, 300);
        } else if (this.dom.btnPlayGame) {
            this.dom.btnPlayGame.style.display = 'inline-flex';
        }
    }

    _updateIntroLoadingProgress() {
        if (this.isReadyToStart) return;

        let pct = 0;
        // Step 1: Initial pipeline setup steps (0..12%)
        const pipelineSteps = 8;
        const currentStep = this._loadPipelineStepIdx || 0;
        pct += Math.min(12, Math.floor((currentStep / pipelineSteps) * 12));

        // Step 2: City model download (0..20%)
        if (this._cityDl) {
            if (this._cityDl.done || this._cityDl.error) {
                pct += 20;
            } else if (this._cityDl.progress) {
                pct += Math.floor(this._cityDl.progress * 20);
            }
        }

        // Step 3: Chunks & stations residency upload (0..68%)
        if (this._residency) {
            const total = (this._residency.totalChunks || 370) + (this._residency.numStations || 27);
            const loaded = (this._resChunks ? this._resChunks.size : 0) + (this._resStations ? this._resStations.size : 0);
            if (this._residency.done) {
                pct += 68;
            } else {
                pct += Math.floor(Math.min(1, loaded / Math.max(1, total)) * 68);
            }
        }

        pct = Math.min(99, Math.max(0, pct));
        if (this._isStartingWarmup) {
            pct = 100;
        }

        this._displayProgress = Math.max(this._displayProgress || 0, pct);
        if (this.dom.introLoadingStatus) {
            this.dom.introLoadingStatus.textContent = `${this._displayProgress} % geladen`;
        }
    }

    _isEverythingFullyLoaded() {
        if (this._isStartingWarmup) return false;
        const cityDone = !this._cityDl || this._cityDl.done || !!this._cityDl.error;
        const residencyDone = this._residency && this._residency.done;
        return cityDone && residencyDone;
    }

    // Renders one frame with frustum culling disabled on every object, so all
    // geometry buffers, textures and shader programs land on the GPU right now
    // (behind the splash screen / button click) instead of lazily during the
    // first frame the train swings into view — that lazy upload of ~1900 buffers
    // was a hard, visible hitch when looking around.
    warmUpRenderer() {
        const restore = [];
        this.world.scene.traverse(o => {
            if (o.frustumCulled) {
                o.frustumCulled = false;
                restore.push(o);
            }
        });
        this.world.renderer.render(this.world.scene, this.world.activeCamera);
        restore.forEach(o => o.frustumCulled = true);

        // One-time interior snapshot for the faux glass reflections — piggybacks
        // on the controlled warm-up hitch (startup and G1<->DT1 switch).
        this.trainModel.bakeInteriorEnvMap(this.world.renderer, this.world.scene);
    }

    // Stößt den Stadtmodell-GLB-Download an — läuft parallel zu den CPU-
    // gebundenen Bauschritten der Lade-Pipeline (siehe init()). Fortschritt
    // und Ergebnis landen in this._cityDl; finishAfterCityModel() wartet
    // darauf und schließt den Ladevorgang ab.
    startCityModelDownload() {
        // Fallback-Gesamtgröße, falls der Server keine Content-Length liefert
        // (z. B. bei gzip-Transfer): city_model.glb ist ~4.7 MB groß.
        const FALLBACK_TOTAL_BYTES = 4.8 * 1024 * 1024;
        this._cityDl = { frac: 0, totalMB: '4.8', done: false, error: null };

        const loader = new GLTFLoader();
        loader.setMeshoptDecoder(MeshoptDecoder);

        loader.load(
            './city_model.glb',
            (gltf) => {
                const model = gltf.scene;

                // Apply the exact position and orientation values determined via debugger
                // (justierbar über das Stadtmodell-Debug-HUD, Taste C)
                model.position.set(-5138.00, 0.00, -3912.00);
                model.rotation.set(0, 0.0000, 0);
                model.scale.set(1.000, 1.000, 1.000);

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

                // Static model, never moves after placement: bake world matrices once
                // and stop the renderer from re-traversing/recomputing this subtree every frame
                model.updateMatrixWorld(true);
                model.matrixWorldAutoUpdate = false;

                this.cityModel = model;
                if (this.world) {
                    this.world.cityModel = model;
                    const isUnderground = (this.sim && this.world.sim)
                        ? (this.world.getChunkTypeAtDistance(this.sim.position) === 'underground')
                        : true;
                    this.cityModel.visible = this.isSpaceIntro ? false : !isUnderground;
                }

                console.log('City model loaded successfully.');
                this._cityDl.done = true;
            },
            (xhr) => {
                const total = xhr.lengthComputable ? xhr.total : FALLBACK_TOTAL_BYTES;
                this._cityDl.frac = Math.min(1, xhr.loaded / total);
                this._cityDl.totalMB = (total / (1024 * 1024)).toFixed(1);
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
                    errorMsg = 'Browser blockiert lokale Dateien (CORS).';
                }
                this._cityDl.error = errorMsg;
            }
        );
    }

    // Schlussphase der Lade-Pipeline: wartet (falls nötig) auf den parallel
    // gestarteten Stadtmodell-Download und zeigt dessen ECHTEN Fortschritt im
    finishAfterCityModel() {
        const poll = () => {
            const dl = this._cityDl;
            if (dl && dl.error) {
                this.warmUpSpawn(() => {}, () => {
                    this.onBackgroundLoadingComplete();
                });
                return;
            }
            if (dl && !dl.done) {
                requestAnimationFrame(poll);
                return;
            }
            this.warmUpSpawn(
                () => {},
                () => {
                    this.onBackgroundLoadingComplete();
                }
            );
        };
        poll();
    }

    // GPU-Warm-up NUR für die Spawn-Umgebung — also die Szene, die nach dem
    // Kulling-Erstlauf ohnehin schon live ist: Zug, Stadtmodell, Stammstrecke,
    // Plärrer, das Chunk-Startfenster und die nahen Stationen. In Batches über
    // mehrere Frames verteilt (der One-Shot-Vorgänger hing sekundenlang), damit
    // der erste Rundumblick am Startbahnhof ruckelfrei ist.
    //
    // Früher lud diese Funktion die GANZE Linie hoch (alle Chunks + alle
    // Stationen temporär in die Szene) — das war der Hauptgrund für die lange
    // Ladezeit. Der Rest der Strecke wird jetzt NACH dem Start im Hintergrund
    // während des Spielens resident gemacht (_beginBackgroundResidency), in
    // winzigen Häppchen von der Zugposition aus nach außen. Einmal hochgeladene
    // Geometrie bleibt dauerhaft auf der GPU (Chunks/Stationen werden nie
    // disposed), deshalb genügt es, jeden Abschnitt einmal kurz zu rendern.
    // `setBar` bekommt den Fortschritt 0..1, `onDone` läuft nach Env-Map-Bake.
    warmUpSpawn(setBar, onDone) {
        if (this.isSpaceIntro) {
            // In Space Intro, geometry is already uploaded via offscreen residency.
            // Only bake the faux glass reflections for the interior:
            if (this.trainModel) {
                this.trainModel.bakeInteriorEnvMap(this.world.renderer, this.world.scene);
            }
            if (onDone) onDone();
            return;
        }

        const meshes = [];
        this.world.scene.traverse(o => { if (o.isMesh) meshes.push(o); });

        // Phase 2 (unten): Geometrie-Buffer gebatcht auf die GPU laden. Der
        // Balken-Anteil dieser Funktion (0..1) spiegelt den echten Upload-
        // Fortschritt; die vorgelagerte Compile-Wartephase deckt der globale
        // Balken-Animator mit seinem Weiterkriechen ab (kein eigener Fake-Wert).
        const startUploadLoop = () => {
            let i = 0;
            let batch = 64;
            const tick = () => {
                const t0 = performance.now();
                const end = Math.min(meshes.length, i + batch);
                const restore = [];
                for (; i < end; i++) {
                    const m = meshes[i];
                    if (m.frustumCulled) { m.frustumCulled = false; restore.push(m); }
                }
                this.world.renderer.render(this.world.scene, this.world.activeCamera);
                restore.forEach(m => m.frustumCulled = true);
                setBar(meshes.length ? i / meshes.length : 1);

                // Batchgröße an die gemessene Frame-Dauer anpassen: zügig
                // durchlaufen, aber keine sekundenlangen Einzel-Frames erzeugen
                const dt = performance.now() - t0;
                if (dt > 150) batch = Math.max(16, batch >> 1);
                else if (dt < 50) batch = Math.min(1024, batch << 1);

                if (i < meshes.length) {
                    requestAnimationFrame(tick);
                } else {
                    // Interieur-Schnappschuss für die Faux-Glas-Reflexionen — jetzt
                    // ist die Spawn-Umgebung warm, der Bake kostet nur einen Frame
                    this.trainModel.bakeInteriorEnvMap(this.world.renderer, this.world.scene);
                    // Alles gerade Hochgeladene als resident merken und den
                    // Hintergrund-Lader für den Rest der Linie scharfschalten.
                    this._seedResidencyFromLiveScene();
                    this._beginBackgroundResidency();
                    onDone();
                }
            };
            requestAnimationFrame(tick);
        };

        // Phase 1: Alle Shader-Programme parallel im Grafiktreiber kompilieren
        // (KHR_parallel_shader_compile via compileAsync). Vorher lief das seriell
        // und blockierend über die render()-Aufrufe der Upload-Schleife — der
        // teuerste Teil des Warm-ups. Jetzt sind beim Upload-Durchlauf unten alle
        // "Rezepte" schon fertig, die Frames werden dadurch deutlich kürzer.
        // Während des (evtl. kurzen) Wartens hält der globale Balken-Animator
        // die Bewegung aufrecht.
        const renderer = this.world.renderer;
        if (typeof renderer.compileAsync === 'function') {
            let started = false;
            const startOnce = () => { if (!started) { started = true; startUploadLoop(); } };
            renderer.compileAsync(this.world.scene, this.world.activeCamera)
                .then(startOnce)
                .catch(startOnce);
        } else {
            // Ältere Renderer ohne compileAsync: direkt zum Upload-Durchlauf,
            // der die Shader dann (wie früher) synchron mitkompiliert.
            startUploadLoop();
        }
    }

    // ------------------------------------------------------------------------
    // Hintergrund-Residency: Rest der Linie während des Spielens nachladen
    // ------------------------------------------------------------------------
    // Nach warmUpSpawn ist nur die Startumgebung auf der GPU. Diese Methoden
    // bauen + laden den Rest der U1-Strecke (Chunks + Stationen) in winzigen,
    // zeitbudgetierten Häppchen nach — immer das der Zugposition nächste offene
    // Ziel zuerst —, sodass beim Fahren nie ein ungeladener Abschnitt auftaucht,
    // ohne dass ein einzelner Frame spürbar hakt ("Flüssigkeit zuerst").
    //
    // Trick: Ein Objekt muss nur EINMAL kurz mit abgeschaltetem Frustum-Culling
    // gerendert werden, damit seine Geometrie/Texturen auf die GPU wandern —
    // danach bleiben die Buffer dort (Chunks/Stationen werden nie disposed).
    // Statt eines eigenen render()-Aufrufs hängen wir die Meshes des Ziels VOR
    // dem normalen Frame-Render in die Szene (Culling aus) und räumen sie danach
    // wieder weg ("Piggyback" auf den einen ohnehin laufenden Render pro Frame).

    // Merkt sich alles, was gerade live (und damit schon hochgeladen) ist, als
    // resident. Läuft nach dem Spawn-Warm-up und nach jedem Teleport.
    _seedResidencyFromLiveScene() {
        if (!this._resChunks) this._resChunks = new Set();
        if (!this._resStations) this._resStations = new Set();
        const tm = this.trackManager, sm = this.stationModel;
        if (tm) for (const idx of tm.activeChunks.keys()) this._resChunks.add(idx);
        if (sm) for (const idx of sm.loadedStations.keys()) this._resStations.add(idx);
    }

    // Startet den Hintergrund-Lader (nur Zustand; die Arbeit passiert in
    // _residencyPrep/_residencyFinish, die animate() pro Frame aufruft).
    _beginBackgroundResidency() {
        const tm = this.trackManager, sm = this.stationModel;
        if (!tm || !sm) return;
        this._residency = {
            totalChunks: Math.floor(this.sim.totalLength / tm.chunkSize),
            numStations: sm.sim.stations.length,
            done: false,
            pending: null, // aktuell zum Upload eingehängtes Ziel (siehe _residencyPrep)
        };
    }

    // Wie viele Meshes pro Frame hochgeladen werden. Klein halten ("Flüssigkeit
    // zuerst") — eine große Station wird so über mehrere Frames verteilt, statt
    // ihre vielen Texturen in einem einzigen Frame hochzuladen.
    static get RESIDENCY_BATCH() { return 48; }

    // Vor dem Frame-Render (in animate, direkt vor world.update): wählt das der
    // Zugposition nächste offene Ziel und hängt einen kleinen Batch seiner Meshes
    // mit abgeschaltetem Culling in die Szene, damit der folgende Render genau
    // die hochlädt. Ein Ziel wird über mehrere Frames abgearbeitet; fehlende
    // Chunks werden zuerst gebaut (eigener Frame ohne Upload).
    _residencyPrep(batchLimit) {
        const r = this._residency;
        if (!r || r.done) return;
        const tm = this.trackManager, sm = this.stationModel;
        if (!tm || !sm) return;

        const trunkTm = this._trunkCtx ? this._trunkCtx.trackManager : null;
        const trunkSm = this._trunkCtx ? this._trunkCtx.stationModel : null;

        const startT = performance.now();
        const TIME_BUDGET_MS = this.isSpaceIntro ? 10 : 2;

        if (this.isSpaceIntro) {
            if (!this._offscreenTarget) {
                this._offscreenTarget = new THREE.WebGLRenderTarget(4, 4);
                this._offscreenScene = new THREE.Scene();
                this._offscreenCam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
            }

            while (performance.now() - startT < TIME_BUDGET_MS) {
                if (!r.pending) {
                    const trainZ = this.sim.position;
                    let best = null, bestDist = Infinity;
                    
                    for (let i = 0; i <= r.totalChunks; i++) {
                        if (this._resChunks.has(i)) continue;
                        const d = Math.abs((i + 0.5) * tm.chunkSize - trainZ);
                        if (d < bestDist) { bestDist = d; best = { kind: 'chunk', idx: i }; }
                    }
                    for (let i = 0; i < r.numStations; i++) {
                        if (this._resStations.has(i)) continue;
                        const st = this.sim.stations[i];
                        if (!st) { this._resStations.add(i); continue; }
                        const d = Math.abs(st.position - trainZ);
                        if (d < bestDist) { bestDist = d; best = { kind: 'station', idx: i }; }
                    }
                    
                    if (trunkTm && !r.trunkDone) {
                        if (!this._resTrunkChunks) this._resTrunkChunks = new Set();
                        const trunkTotalChunks = Math.ceil(this._trunkSim.totalLength / trunkTm.chunkSize);
                        let foundTrunk = false;
                        for (let i = 0; i <= trunkTotalChunks; i++) {
                            if (!this._resTrunkChunks.has(i)) {
                                const d = 5000;
                                if (d < bestDist) { bestDist = d; best = { kind: 'trunkChunk', idx: i }; }
                                foundTrunk = true;
                                break;
                            }
                        }
                        if (!foundTrunk) {
                            if (!this._resTrunkStations) this._resTrunkStations = new Set();
                            let foundStation = false;
                            for (let i = 0; i < trunkSm.sim.stations.length; i++) {
                                if (!this._resTrunkStations.has(i)) {
                                    const d = 5000;
                                    if (d < bestDist) { bestDist = d; best = { kind: 'trunkStation', idx: i }; }
                                    foundStation = true;
                                    break;
                                }
                            }
                            if (!foundStation) r.trunkDone = true;
                        }
                    }

                    if (!best) { r.done = true; return; }

                    let obj, parent;
                    if (best.kind === 'chunk') {
                        obj = tm.chunkCache.get(best.idx);
                        if (!obj) {
                            obj = tm.createChunk(best.idx);
                            tm.chunkCache.set(best.idx, obj);
                        }
                        parent = tm.scene;
                    } else if (best.kind === 'station') {
                        obj = sm.stationsList[best.idx];
                        if (!obj) {
                            obj = sm.buildStationAtIndex(best.idx);
                        }
                        parent = sm.scene;
                    } else if (best.kind === 'trunkChunk') {
                        obj = trunkTm.chunkCache.get(best.idx);
                        if (!obj) {
                            obj = trunkTm.createChunk(best.idx);
                            trunkTm.chunkCache.set(best.idx, obj);
                            trunkTm.activeChunks.set(best.idx, obj);
                            trunkTm.scene.add(obj);
                        }
                        parent = trunkTm.scene;
                    } else if (best.kind === 'trunkStation') {
                        obj = trunkSm.stationsList[best.idx];
                        if (!obj) {
                            obj = trunkSm.buildStationAtIndex(best.idx);
                            trunkSm.scene.add(obj);
                        }
                        parent = trunkSm.scene;
                    }
                    
                    const allMeshes = [];
                    obj.traverse(o => { if (o.isMesh) allMeshes.push(o); });
                    r.pending = { kind: best.kind, idx: best.idx, obj, parent, allMeshes, cursor: 0, uncculled: [] };
                }

                // Upload pending meshes
                const p = r.pending;
                const maxBatch = 128;
                const end = Math.min(p.allMeshes.length, p.cursor + maxBatch);

                this._offscreenScene.add(p.obj);
                for (let i = p.cursor; i < end; i++) {
                    const m = p.allMeshes[i];
                    if (m.frustumCulled) { m.frustumCulled = false; p.uncculled.push(m); }
                }
                this.world.renderer.setRenderTarget(this._offscreenTarget);
                this.world.renderer.render(this._offscreenScene, this._offscreenCam);
                this.world.renderer.setRenderTarget(null);
                this._offscreenScene.remove(p.obj);

                for (const m of p.uncculled) m.frustumCulled = true;
                p.uncculled = [];
                p.cursor = end;

                if (p.cursor >= p.allMeshes.length) {
                    if (p.kind === 'chunk') this._resChunks.add(p.idx);
                    else if (p.kind === 'station') this._resStations.add(p.idx);
                    else if (p.kind === 'trunkChunk') this._resTrunkChunks.add(p.idx);
                    else if (p.kind === 'trunkStation') this._resTrunkStations.add(p.idx);
                    r.pending = null;
                } else {
                    break;
                }
            }
            return;
        }

        while (!r.pending && (performance.now() - startT < TIME_BUDGET_MS)) {
            const trainZ = this.sim.position;
            let best = null, bestDist = Infinity;
            
            for (let i = 0; i <= r.totalChunks; i++) {
                if (this._resChunks.has(i)) continue;
                const d = Math.abs((i + 0.5) * tm.chunkSize - trainZ);
                if (d < bestDist) { bestDist = d; best = { kind: 'chunk', idx: i }; }
            }
            for (let i = 0; i < r.numStations; i++) {
                if (this._resStations.has(i)) continue;
                const st = this.sim.stations[i];
                if (!st) { this._resStations.add(i); continue; }
                const d = Math.abs(st.position - trainZ);
                if (d < bestDist) { bestDist = d; best = { kind: 'station', idx: i }; }
            }
            
            if (trunkTm && !r.trunkDone) {
                if (!this._resTrunkChunks) this._resTrunkChunks = new Set();
                const trunkTotalChunks = Math.ceil(this._trunkSim.totalLength / trunkTm.chunkSize);
                let foundTrunk = false;
                for (let i = 0; i <= trunkTotalChunks; i++) {
                    if (!this._resTrunkChunks.has(i)) {
                        const d = 5000;
                        if (d < bestDist) { bestDist = d; best = { kind: 'trunkChunk', idx: i }; }
                        foundTrunk = true;
                        break;
                    }
                }
                if (!foundTrunk) {
                    if (!this._resTrunkStations) this._resTrunkStations = new Set();
                    let foundStation = false;
                    for (let i = 0; i < trunkSm.sim.stations.length; i++) {
                        if (!this._resTrunkStations.has(i)) {
                            const d = 5000;
                            if (d < bestDist) { bestDist = d; best = { kind: 'trunkStation', idx: i }; }
                            foundStation = true;
                            break;
                        }
                    }
                    if (!foundStation) r.trunkDone = true;
                }
            }

            if (!best) { r.done = true; return; }

            let obj, parent, owned;
            if (best.kind === 'chunk') {
                obj = tm.chunkCache.get(best.idx);
                if (!obj) {
                    obj = tm.createChunk(best.idx);
                    tm.chunkCache.set(best.idx, obj);
                    continue;
                }
                owned = tm.activeChunks.has(best.idx);
                parent = tm.scene;
            } else if (best.kind === 'station') {
                obj = sm.stationsList[best.idx];
                if (!obj) {
                    obj = sm.buildStationAtIndex(best.idx);
                    continue;
                }
                owned = sm.loadedStations.has(best.idx);
                parent = sm.scene;
            } else if (best.kind === 'trunkChunk') {
                obj = trunkTm.chunkCache.get(best.idx);
                if (!obj) {
                    obj = trunkTm.createChunk(best.idx);
                    trunkTm.chunkCache.set(best.idx, obj);
                    trunkTm.activeChunks.set(best.idx, obj);
                    trunkTm.scene.add(obj);
                    continue;
                }
                owned = true;
                parent = trunkTm.scene;
            } else if (best.kind === 'trunkStation') {
                obj = trunkSm.stationsList[best.idx];
                if (!obj) {
                    obj = trunkSm.buildStationAtIndex(best.idx);
                    trunkSm.scene.add(obj);
                    continue;
                }
                owned = true;
                parent = trunkSm.scene;
            }
            
            if (!owned) parent.add(obj);
            const allMeshes = [];
            obj.traverse(o => { if (o.isMesh) allMeshes.push(o); });
            r.pending = { kind: best.kind, idx: best.idx, obj, parent, allMeshes, cursor: 0, uncculled: [] };
            break;
        }

        if (!r.pending) return;

        // Normal in-game residency (if ever needed):
        const p = r.pending;
        p.uncculled = [];
        const maxBatch = batchLimit || App.RESIDENCY_BATCH;
        const end = Math.min(p.allMeshes.length, p.cursor + maxBatch);
        for (; p.cursor < end; p.cursor++) {
            const m = p.allMeshes[p.cursor];
            if (m.frustumCulled) { m.frustumCulled = false; p.uncculled.push(m); }
        }
    }

    // Nach dem Frame-Render (in animate, direkt nach world.update): Culling des
    // gerade hochgeladenen Batches zurücksetzen. Ist das Ziel komplett, wird es
    // ggf. wieder aus der Szene genommen (die GPU-Buffer bleiben erhalten) und
    // als resident markiert.
    _residencyFinish() {
        const r = this._residency;
        if (!r || !r.pending) return;
        const p = r.pending;
        for (const m of p.uncculled) m.frustumCulled = true;
        p.uncculled = [];
        if (p.cursor < p.allMeshes.length) return; // Ziel noch nicht fertig

        if (!this.isSpaceIntro) {
            let owned = true;
            if (p.kind === 'chunk') {
                owned = this.trackManager.activeChunks.has(p.idx);
            } else if (p.kind === 'station') {
                owned = this.stationModel.loadedStations.has(p.idx);
            }
            if (!owned) p.parent.remove(p.obj);
        }
        
        if (p.kind === 'chunk') this._resChunks.add(p.idx);
        else if (p.kind === 'station') this._resStations.add(p.idx);
        else if (p.kind === 'trunkChunk') this._resTrunkChunks.add(p.idx);
        else if (p.kind === 'trunkStation') this._resTrunkStations.add(p.idx);
        
        r.pending = null;
    }

    // Teleport-Fall "kurz vorladen, dann zeigen": die vom Teleport frisch
    // eingeblendete Zielumgebung sofort synchron auf die GPU schieben (ein
    // kontrollierter Kurz-Hänger statt eines Überraschungs-Rucklers beim ersten
    // Frame am Ziel), danach als resident markieren.
    _ensureResidentNow() {
        if (!this.world || !this.world.renderer) return;
        this.warmUpRenderer(); // rendert die aktuelle Live-Szene einmal Culling-aus
        this._seedResidencyFromLiveScene();
    }

    toggleCityDebugHud() {
        const hud = document.getElementById('city-debug-hud');
        if (!hud) return;

        if (!this.cityModel) {
            console.warn('City-Debug-HUD: Stadtmodell ist noch nicht geladen.');
            return;
        }

        this.cityDebugVisible = !this.cityDebugVisible;
        hud.style.display = this.cityDebugVisible ? 'block' : 'none';

        if (this.cityDebugVisible && !this.cityDebugBuilt) {
            this.buildCityDebugHud();
            this.cityDebugBuilt = true;
        }

        if (this.cityDebugVisible) {
            this.refreshCityDebugHud();
        }
    }

    // Behelfs-Overlay (Taste C) zum groben/feinen Verschieben, Rotieren und
    // Skalieren des Stadtmodells, samt Live-Ablesung der Koordinaten.
    buildCityDebugHud() {
        const hud = document.getElementById('city-debug-hud');
        if (!hud) return;

        const axisSteps = {
            x: [10, 0.1], y: [10, 0.1], z: [10, 0.1],
            ry: [15, 1], scale: [0.1, 0.01]
        };
        const axisLabels = { x: 'X', y: 'Y', z: 'Z', ry: 'Rot Y (°)', scale: 'Skalierung' };

        let html = '<div class="cd-title">Stadtmodell-Position (Taste C zum Schließen)</div>';
        for (const axis of Object.keys(axisSteps)) {
            const [coarse, fine] = axisSteps[axis];
            html += `
                <div class="cd-row" data-axis="${axis}">
                    <span class="cd-label">${axisLabels[axis]}</span>
                    <button class="cd-btn" data-axis="${axis}" data-step="${-coarse}">-${coarse}</button>
                    <button class="cd-btn" data-axis="${axis}" data-step="${-fine}">-${fine}</button>
                    <input type="number" class="cd-input" data-axis="${axis}" step="any">
                    <button class="cd-btn" data-axis="${axis}" data-step="${fine}">+${fine}</button>
                    <button class="cd-btn" data-axis="${axis}" data-step="${coarse}">+${coarse}</button>
                </div>`;
        }
        html += `
            <textarea id="cd-output" class="cd-output" rows="3" readonly></textarea>
            <button id="cd-copy" class="cd-btn cd-copy">Code kopieren</button>`;

        hud.innerHTML = html;

        const applyStep = (axis, step) => {
            const model = this.cityModel;
            if (axis === 'x') model.position.x += step;
            else if (axis === 'y') model.position.y += step;
            else if (axis === 'z') model.position.z += step;
            else if (axis === 'ry') model.rotation.y += THREE.MathUtils.degToRad(step);
            else if (axis === 'scale') {
                const s = Math.max(0.01, model.scale.x + step);
                model.scale.set(s, s, s);
            }
            // Model has matrixWorldAutoUpdate = false (perf optimization for the static
            // city mesh) - bake the new transform manually so the change is visible.
            model.updateMatrixWorld(true);
            this.refreshCityDebugHud();
        };

        hud.querySelectorAll('.cd-btn[data-axis]').forEach(btn => {
            btn.addEventListener('click', () => {
                applyStep(btn.dataset.axis, parseFloat(btn.dataset.step));
            });
        });

        hud.querySelectorAll('.cd-input').forEach(input => {
            input.addEventListener('change', () => {
                const axis = input.dataset.axis;
                const value = parseFloat(input.value);
                if (Number.isNaN(value)) return;
                const model = this.cityModel;
                if (axis === 'x') model.position.x = value;
                else if (axis === 'y') model.position.y = value;
                else if (axis === 'z') model.position.z = value;
                else if (axis === 'ry') model.rotation.y = THREE.MathUtils.degToRad(value);
                else if (axis === 'scale') model.scale.set(value, value, value);
                model.updateMatrixWorld(true);
                this.refreshCityDebugHud();
            });
        });

        document.getElementById('cd-copy').addEventListener('click', () => {
            const output = document.getElementById('cd-output');
            output.select();
            navigator.clipboard.writeText(output.value).catch(() => {});
        });
    }

    refreshCityDebugHud() {
        const hud = document.getElementById('city-debug-hud');
        const model = this.cityModel;
        if (!hud || !model) return;

        const values = {
            x: model.position.x, y: model.position.y, z: model.position.z,
            ry: THREE.MathUtils.radToDeg(model.rotation.y), scale: model.scale.x
        };
        for (const axis of Object.keys(values)) {
            const input = hud.querySelector(`.cd-input[data-axis="${axis}"]`);
            if (input && document.activeElement !== input) {
                input.value = Number(values[axis].toFixed(3));
            }
        }

        const output = document.getElementById('cd-output');
        if (output) {
            output.value =
                `model.position.set(${values.x.toFixed(2)}, ${values.y.toFixed(2)}, ${values.z.toFixed(2)});\n` +
                `model.rotation.set(0, ${THREE.MathUtils.degToRad(values.ry).toFixed(4)}, 0);\n` +
                `model.scale.set(${values.scale.toFixed(3)}, ${values.scale.toFixed(3)}, ${values.scale.toFixed(3)});`;
        }
    }

    toggleGlassDebugHud() {
        const hud = document.getElementById('glass-debug-hud');
        if (!hud) return;

        this.glassDebugVisible = !this.glassDebugVisible;
        hud.style.display = this.glassDebugVisible ? 'block' : 'none';

        if (this.glassDebugVisible && !this.glassDebugBuilt) {
            this.buildGlassDebugHud();
            this.glassDebugBuilt = true;
        }

        if (this.glassDebugVisible) {
            this.refreshGlassDebugHud();
        }
    }

    // Behelfs-Overlay (Taste P) zum Live-Tunen der Faux-Glasreflexionen
    // (statische Interieur-Cubemap, siehe TrainModel.createFauxGlassMaterial):
    // Reflektivität, Fresnel-Basis und Tönung pro Glasgruppe, samt
    // Copy-Paste-Zeilen für den this.materials-Block in TrainModel.js.
    buildGlassDebugHud() {
        const hud = document.getElementById('glass-debug-hud');
        if (!hud) return;

        this.glassDebugGroups = [
            { key: 'window', label: 'Seitenfenster', mats: ['windowGlass', 'cabWindowGlass'] },
            { key: 'windshield', label: 'Windschutzscheibe', mats: ['windshieldGlass'] },
            { key: 'partition', label: 'Rückwand (Cockpit)', mats: ['partitionGlass'] }
        ];
        this.glassDebugParams = [
            { key: 'reflectivity', uniform: 'uReflectivity', label: 'Reflexion', min: 0, max: 1, step: 0.01 },
            { key: 'fresnelBase', uniform: 'uFresnelBase', label: 'Fresnel-Basis', min: 0, max: 1, step: 0.01 },
            { key: 'opacity', uniform: 'uOpacity', label: 'Tönung', min: 0, max: 0.3, step: 0.005 }
        ];

        let html = '<div class="cd-title">Glas-Reflexionen (Taste P zum Schließen)</div>';
        for (const group of this.glassDebugGroups) {
            html += `<div class="gd-group">${group.label}</div>`;
            for (const p of this.glassDebugParams) {
                html += `
                    <div class="cd-row">
                        <span class="cd-label">${p.label}</span>
                        <input type="range" class="gd-slider" data-group="${group.key}" data-param="${p.key}"
                               min="${p.min}" max="${p.max}" step="${p.step}">
                        <input type="number" class="cd-input" data-group="${group.key}" data-param="${p.key}" step="${p.step}">
                    </div>`;
            }
        }
        html += `
            <textarea id="gd-output" class="cd-output" rows="5" readonly></textarea>
            <button id="gd-copy" class="cd-btn cd-copy">Code kopieren</button>`;

        hud.innerHTML = html;

        hud.querySelectorAll('.gd-slider, .cd-input').forEach(input => {
            input.addEventListener('input', () => {
                const value = parseFloat(input.value);
                if (Number.isNaN(value)) return;
                const param = this.glassDebugParams.find(p => p.key === input.dataset.param);
                for (const mat of this.glassDebugGroupMats(input.dataset.group)) {
                    mat.uniforms[param.uniform].value = value;
                }
                this.refreshGlassDebugHud();
            });
        });

        document.getElementById('gd-copy').addEventListener('click', () => {
            const output = document.getElementById('gd-output');
            output.select();
            navigator.clipboard.writeText(output.value).catch(() => {});
        });
    }

    // Materials are resolved live from trainModel (not captured at build time)
    // so the panel keeps working if the train model is ever rebuilt/switched.
    glassDebugGroupMats(groupKey) {
        const group = this.glassDebugGroups.find(g => g.key === groupKey);
        if (!group || !this.trainModel) return [];
        return group.mats.map(name => this.trainModel.materials[name]).filter(Boolean);
    }

    refreshGlassDebugHud() {
        const hud = document.getElementById('glass-debug-hud');
        if (!hud || !this.glassDebugGroups) return;

        // Sync sliders and number fields from the live uniform values
        for (const group of this.glassDebugGroups) {
            const mat = this.glassDebugGroupMats(group.key)[0];
            if (!mat) continue;
            for (const p of this.glassDebugParams) {
                const value = mat.uniforms[p.uniform].value;
                hud.querySelectorAll(`[data-group="${group.key}"][data-param="${p.key}"]`).forEach(el => {
                    if (document.activeElement !== el) el.value = Number(value.toFixed(3));
                });
            }
        }

        // Paste-ready lines for the this.materials block in TrainModel.js
        const output = document.getElementById('gd-output');
        if (output && this.trainModel) {
            const line = (name, tint, comment) => {
                const mat = this.trainModel.materials[name];
                if (!mat) return '';
                const u = mat.uniforms;
                return `${name}: this.createFauxGlassMaterial({ tint: '${tint}', opacity: ${Number(u.uOpacity.value.toFixed(3))}, reflectivity: ${Number(u.uReflectivity.value.toFixed(2))}, fresnelBase: ${Number(u.uFresnelBase.value.toFixed(2))} }),${comment}`;
            };
            output.value = [
                line('windowGlass', '#ffffff', ''),
                line('cabWindowGlass', '#ffffff', ' // no reflection: curved cab glass broke the box-test math'),
                line('windshieldGlass', '#ffffff', ' // subtler, so the driver\'s forward view stays clear head-on'),
                line('partitionGlass', '#000000', ' // cab rear-wall (Rückwand) panes: 50% tinted')
            ].filter(Boolean).join('\n');
        }
    }

    // Sound-Mixer Debug-Overlay (Taste N) zum Live-Justieren/Identifizieren der
    // synthetisierten Fahrgeräusche (AudioManager.debugMix-Multiplikatoren).
    toggleSoundDebugHud() {
        const hud = document.getElementById('sound-debug-hud');
        if (!hud) return;

        this.soundDebugVisible = !this.soundDebugVisible;
        hud.style.display = this.soundDebugVisible ? 'block' : 'none';

        if (this.soundDebugVisible && !this.soundDebugBuilt) {
            this.buildSoundDebugHud();
            this.soundDebugBuilt = true;
        }

        if (this.soundDebugVisible) {
            this.refreshSoundDebugHud();
        }
    }

    buildSoundDebugHud() {
        const hud = document.getElementById('sound-debug-hud');
        if (!hud) return;

        // WICHTIG: Die Keys müssen exakt den Einträgen in AudioManager.debugMix
        // entsprechen — ein Kanal ohne Gegenstück dort ließ das HUD früher mit
        // einem TypeError abstürzen.
        this.soundDebugChannels = [
            { key: 'inverter', label: 'Inverter (Umrichter-Sirren)' },
            { key: 'dt1Rumble', label: 'DT1-Rumpeln' },
            { key: 'dt1Growl', label: 'DT1-Growl' },
            { key: 'startupSing', label: 'Anfahr-Singen (G1)' },
            { key: 'brake', label: 'Bremsquietschen' },
            { key: 'rolling', label: 'Rollgeräusch (Schienen)' },
            { key: 'ambiance', label: 'Ambiance (Zug & Station)' }
        ];

        let html = '<div class="cd-title">Sound-Mixer (Taste N zum Schließen)</div>';
        for (const ch of this.soundDebugChannels) {
            html += `
                <div class="cd-row">
                    <span class="cd-label">${ch.label}</span>
                    <input type="range" class="gd-slider" data-channel="${ch.key}" min="0" max="2" step="0.01">
                    <input type="number" class="cd-input" data-channel="${ch.key}" min="0" max="2" step="0.01">
                </div>`;
        }
        html += `
            <button id="sd-reset" class="cd-btn cd-copy">Zurücksetzen</button>`;

        hud.innerHTML = html;

        hud.querySelectorAll('.gd-slider, .cd-input').forEach(input => {
            input.addEventListener('input', () => {
                const value = parseFloat(input.value);
                if (Number.isNaN(value)) return;
                this.audio.debugMix[input.dataset.channel] = value;
                this.refreshSoundDebugHud();
            });
        });

        document.getElementById('sd-reset').addEventListener('click', () => {
            for (const ch of this.soundDebugChannels) this.audio.debugMix[ch.key] = 1;
            this.refreshSoundDebugHud();
        });
    }

    refreshSoundDebugHud() {
        const hud = document.getElementById('sound-debug-hud');
        if (!hud || !this.soundDebugChannels) return;

        for (const ch of this.soundDebugChannels) {
            const value = this.audio.debugMix[ch.key];
            hud.querySelectorAll(`[data-channel="${ch.key}"]`).forEach(el => {
                if (document.activeElement !== el) el.value = Number(value.toFixed(2));
            });
        }
    }

    launchGame() {
        if (!this.isReadyToStart || this._isTransitioning) return;
        this._isTransitioning = true;

        if (this.dom.splash) this.dom.splash.style.display = 'none';
        if (this.dom.btnPlayGame) this.dom.btnPlayGame.style.display = 'none';
        if (this.dom.introLoadingStatus) this.dom.introLoadingStatus.style.display = 'none';
        if (this.dom.introStatusContainer) this.dom.introStatusContainer.style.display = 'none';

        if (document.body.classList.contains('is-mobile')) {
            this.requestFullscreen();
        }

        // Initialize Audio Context (user gesture)
        this.audio.init();

        // Trigger warp acceleration effect
        if (this.spaceIntro) {
            this.spaceIntro.triggerWarp(() => {
                this._completeGameLaunch();
            });
        } else {
            this._completeGameLaunch();
        }
    }

    _completeGameLaunch() {
        if (this.spaceIntro) {
            this.spaceIntro.dispose();
            this.spaceIntro = null;
        }
        this.world.isSpaceIntro = false;
        this.isSpaceIntro = false;
        this._isTransitioning = false;

        // Reparent train into lineRoot and remove temporary space trainRoot
        if (this.trainModel && this.lineRoot) {
            this.lineRoot.add(this.trainModel.group);
            if (this.trainRoot && this.trainRoot.parent) {
                this.trainRoot.parent.remove(this.trainRoot);
            }
        }

        // Make the entire subway line and active rig visible!
        if (this.lineRoot) this.lineRoot.visible = true;
        if (this.lineRigs && this.lineRigs[this.activeLineId] && this.lineRigs[this.activeLineId].lineRoot) {
            this.lineRigs[this.activeLineId].lineRoot.visible = true;
        }
        if (this.plaerrerGroup) this.plaerrerGroup.visible = true;
        if (this.trunkGroup) this.trunkGroup.visible = true;

        // Exit straight cosmos mode so carriages align with real track curves
        if (this.trainModel) {
            this.trainModel.isStraight = false;
        }

        // Activate initial position at start station
        this.trackManager.update(this.sim.position);
        this.updateTrunkVisibility();
        this.updateSwitchVisibility();
        this.stationModel.update(this.sim.position);
        this.trainModel.update(0);

        // Force camera and environment lighting update to the station
        this.world.update(0.016, this.trainModel);
        this.world.updateEnvironmentLighting(this.sim.position, 0.016);

        // Restore sky/environment
        if (this.world.skyTexture) {
            this.world.scene.background = this.world.skyTexture;
        }

        this.isRunning = true;
        this.clock.getDelta();
    }

    startSimulation() {
        this.launchGame();
    }

    requestFullscreen() {
        const el = document.documentElement;
        const request = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
        if (request) {
            const result = request.call(el);
            if (result && result.catch) result.catch(() => {}); // ignore denial/unsupported
        }
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
                if (this.updateCamMobileLabel) this.updateCamMobileLabel();
                btn.blur();
            });
        });

        // 2. Keyboard bindings
        document.addEventListener('keydown', (e) => {
            // Performance HUD toggle (works regardless of simulation state)
            if (e.key.toLowerCase() === 'o') {
                this.perfHudVisible = !this.perfHudVisible;
                const hud = document.getElementById('perf-hud');
                if (hud) hud.style.display = this.perfHudVisible ? 'block' : 'none';
                this.perfFrames = 0;
                this.perfTimer = 0;
            }

            // Glass reflection tuning HUD toggle (works regardless of simulation state)
            if (e.key.toLowerCase() === 'p') {
                this.toggleGlassDebugHud();
            }

            // City model placement debug HUD toggle (works regardless of simulation state)
            if (e.key.toLowerCase() === 'c') {
                this.toggleCityDebugHud();
            }

            // Sound mixer tuning HUD toggle (works regardless of simulation state)
            if (e.key.toLowerCase() === 'n') {
                this.toggleSoundDebugHud();
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
                this.toggleAto();
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

        const autoBtn = document.getElementById('btn-mobile-auto');
        if (autoBtn) {
            autoBtn.addEventListener('click', () => {
                if (!this.isRunning) return;
                this.sim.resetSifa();
                this.toggleAto();
            });
        }

        // Walking joystick (right of the throttle slider): drives the same
        // passenger/platform walk logic as the arrow keys, via an analog
        // -1..1 vector fed to WorldManager.setMobileWalkInput.
        const joystick = document.getElementById('mobile-joystick');
        const joystickKnob = document.getElementById('mobile-joystick-knob');
        if (joystick && joystickKnob) {
            const maxRadius = 32; // px knob travel radius
            let activeTouchId = null;

            const setKnob = (dx, dy) => {
                joystickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
            };

            const resetKnob = () => {
                setKnob(0, 0);
                this.world.setMobileWalkInput(0, 0);
            };

            const handleMove = (clientX, clientY) => {
                const rect = joystick.getBoundingClientRect();
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;
                let dx = clientX - cx;
                let dy = clientY - cy;
                const dist = Math.hypot(dx, dy);
                if (dist > maxRadius) {
                    dx = dx / dist * maxRadius;
                    dy = dy / dist * maxRadius;
                }
                setKnob(dx, dy);
                // Forward = up on screen (negative dy)
                this.world.setMobileWalkInput(dx / maxRadius, -dy / maxRadius);
            };

            joystick.addEventListener('touchstart', (e) => {
                const t = e.changedTouches[0];
                activeTouchId = t.identifier;
                handleMove(t.clientX, t.clientY);
                e.preventDefault();
            }, { passive: false });

            joystick.addEventListener('touchmove', (e) => {
                for (const t of e.changedTouches) {
                    if (t.identifier === activeTouchId) {
                        handleMove(t.clientX, t.clientY);
                        e.preventDefault();
                    }
                }
            }, { passive: false });

            const endJoystickTouch = (e) => {
                for (const t of e.changedTouches) {
                    if (t.identifier === activeTouchId) {
                        activeTouchId = null;
                        resetKnob();
                    }
                }
            };
            joystick.addEventListener('touchend', endJoystickTouch);
            joystick.addEventListener('touchcancel', endJoystickTouch);
        }
    }

    toggleAto() {
        this.sim.atoMode = !this.sim.atoMode;
        this.audio.playAutopilotChime(this.sim.atoMode);
        const autoBtn = document.getElementById('btn-mobile-auto');
        if (autoBtn) {
            autoBtn.textContent = this.sim.atoMode ? 'Auto: An' : 'Auto: Aus';
            autoBtn.classList.toggle('active', this.sim.atoMode);
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
        const stopPos = this.sim.getStationStopPosition ? this.sim.getStationStopPosition(nextStation) : nextStation.position;
        const distToStation = Math.abs(trainCenter - stopPos);
        const isAtPlatform = distToStation < 12;

        if (this.sim.doorState === 0 || this.sim.doorState === 3) {
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

        if (this.isSpaceIntro) {
            if (this.spaceIntro) {
                this.spaceIntro.update(dt);
            }
            if (this.trainModel) {
                this.trainModel.update(dt);
            }

            // Update loading progress display ("XX % geladen")
            this._updateIntroLoadingProgress();

            // Pump full line residency in background: builds and uploads ALL 27 stations and ALL 370 chunks!
            if (this._residency && !this._residency.done) {
                this._residencyPrep(128);
                this.world.update(dt, this.trainModel);
                this._residencyFinish();
            } else {
                this.world.update(dt, this.trainModel);
            }

            // Check if EVERYTHING (city model + 100% of all chunks and stations) is fully loaded!
            if (!this.isReadyToStart && this._isEverythingFullyLoaded()) {
                this._isStartingWarmup = true;
                this.warmUpSpawn(() => {}, () => {
                    this.onBackgroundLoadingComplete();
                });
            }
            return;
        }

        if (this.isRunning) {
            // 1. Physics Engine Update (Deterministic 60 Hz Fixed Timestep Accumulator)
            const FIXED_DT = 1 / 60;
            this._physicsAccumulator = (this._physicsAccumulator || 0) + dt;
            let substeps = 0;
            while (this._physicsAccumulator >= FIXED_DT && substeps < 5) {
                this.sim.update(FIXED_DT);
                this._physicsAccumulator -= FIXED_DT;
                substeps++;
            }
            if (this._physicsAccumulator > FIXED_DT * 2) {
                this._physicsAccumulator = 0; // prevent spiral of death on long browser hitches
            }

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
            const isPlatform = (this.world.activeCameraType === 'platform');
            const stationDist = isPlatform ? 0 : this.getDistanceToNearestStation();
            this.audio.update(this.sim.speed, this.sim.throttle, this.sim.brakeCylinderPressure, dt, isInside, stationDist, isPlatform);

            // Escalator proximity sounds
            this.updateEscalatorAmbience(dt);

            // Radio click signals from WorldManager's raycast (see there for the button zones)
            if (this.sim.wantsRadioPlay) {
                this.radio.startDefaultStation(); // turning it on always starts on the default station
                this.sim.radioActive = true;
                this.sim.wantsRadioPlay = false;
            }
            if (this.sim.wantsRadioNext) {
                this.radio.nextStation(); // zaps into a random song of the next station
                this.sim.wantsRadioNext = false;
            }
            if (this.sim.wantsRadioOff) {
                this.radio.stop();
                this.sim.radioActive = false;
                this.sim.wantsRadioOff = false;
            }

            // Keep the in-cab radio display screen (station + currently playing song) in
            // sync. Cheap string compare so this only redraws the canvas when something
            // actually changed - covers zaps as well as the RadioManager's own natural
            // playlist advance (onended -> next track) which happens with no user click.
            const radioKey = this.sim.radioActive
                ? `${this.radio.getStationName()}|${this.radio.getCurrentSongName()}`
                : 'off';
            if (radioKey !== this.lastRadioDisplayKey) {
                this.lastRadioDisplayKey = radioKey;
                this.trainModel.updateRadioDisplay(
                    this.sim.radioActive ? this.radio.getStationName() : null,
                    this.sim.radioActive ? this.radio.getCurrentSongName() : null,
                    this.sim.radioActive
                );
            }
        }

        // Always update 3D scene
        const time = this.clock.elapsedTime;
        this.trackManager.update(this.sim.position);
        this.trackManager.tick(dt, time);
        this.updateTrunkVisibility();
        this.updateSwitchVisibility();
        this.stationModel.update(this.sim.position);
        this.stationModel.tick(dt, time);
        this.trainModel.update(dt);

        // Hintergrund-Residency: nächstes Ziel VOR dem Render einhängen (Culling
        // aus), damit world.update()'s Render es hochlädt, danach wieder wegräumen.
        this._residencyPrep();
        this.world.update(dt, this.trainModel);
        this._residencyFinish();

        // Performance HUD (Taste O): FPS + Renderer-Statistiken, 2x pro Sekunde aktualisiert
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

    // Sammelt die Weltpositionen aller aktuell sichtbaren Rolltreppen aus den
    // Registrierungs-Listen (StationModel/TrackManager.registerEscalator) neu
    // ein. Läuft nur alle 0.5 s — Rolltreppen sind statisch, nur ihr
    // Kulling-Zustand ändert sich. Ersetzt das frühere Traversal der KOMPLETTEN
    // Szene (inkl. Stadtmodell) in jedem Frame, das ein Framedrop-Herd war.
    refreshEscalatorCache() {
        const sources = [];
        const collect = (list) => { if (list) sources.push(...list); };
        collect(this.stationModel && this.stationModel.escalators);
        collect(this.trackManager && this.trackManager.escalators); // Plärrer-Halle
        collect(this._trunkStationModel && this._trunkStationModel.escalators);
        // Nicht-U1-Linien nutzen die von U1s TrackManager gebaute Plärrer-Halle mit
        if (this.lineRigs.U1 && this.trackManager !== this.lineRigs.U1.trackManager) {
            collect(this.lineRigs.U1.trackManager.escalators);
        }

        this._escalatorCache.length = 0;
        for (const mesh of sources) {
            // Nur Rolltreppen zählen, die gerade wirklich in der sichtbaren
            // Szene hängen (Stations-Kulling + ausgeblendete Linien-Roots).
            let node = mesh;
            let inScene = false;
            while (node) {
                if (node.visible === false) break;
                if (node === this.world.scene) { inScene = true; break; }
                node = node.parent;
            }
            if (!inScene) continue;
            this._escalatorCache.push(mesh.getWorldPosition(new THREE.Vector3()));
        }
    }

    updateEscalatorAmbience(dt) {
        if (!this.world || !this.audio) return;

        this._escalatorTimer -= dt;
        if (this._escalatorTimer <= 0) {
            this._escalatorTimer = 0.5;
            this.refreshEscalatorCache();
        }

        // Nächstgelegene Rolltreppe aus dem Positions-Cache (kein Traversal,
        // keine Allokationen im Frame-Pfad)
        const playerPos = this.world.activeCamera.getWorldPosition(_escPlayerPos);
        let minDistSq = Infinity;
        for (const pos of this._escalatorCache) {
            const d2 = playerPos.distanceToSquared(pos);
            if (d2 < minDistSq) minDistSq = d2;
        }

        const dist = Math.sqrt(minDistSq); // Infinity -> intensity 0
        // Linear fade out between 3m and 18m
        const intensity = 1.0 - Math.max(0, Math.min(1, (dist - 3) / 15));

        this.audio.updateEscalatorSound(intensity, dt);
    }

    getDistanceToNearestStation() {
        if (!this.sim || !this.sim.stations || this.sim.stations.length === 0) return Infinity;
        const pos = this.sim.position;
        let minDist = Infinity;
        for (let i = 0; i < this.sim.stations.length; i++) {
            const d = Math.abs(this.sim.stations[i].position - pos);
            if (d < minDist) minDist = d;
        }
        return minDist;
    }

    teleportToStation(stationIdx) {
        const station = this.sim.stations[stationIdx];
        if (!station) return;

        // Reset speed and control inputs
        this.sim.speed = 0;
        this.sim.acceleration = 0;
        this.sim.throttle = -0.5; // Apply holding brakes
        this.sim.brakeCylinderPressure = 2.25; // Matching the holding brake pressure
        if (this.sim.emergencyBrake) {
            this.sim.emergencyBrake = false;
            if (this.sim.onEmergencyBrakeChange) {
                this.sim.onEmergencyBrakeChange(false);
            }
        }

        // Reset door status
        this.sim.doorsOpen = false;
        this.sim.doorState = 0; // closed
        this.sim.doorProgress = 0;
        this.sim.doorWarningActive = false;

        // Teleport position to the station platform center (offset by trainHalfLength to center the train)
        const stopPos = this.sim.getStationStopPosition ? this.sim.getStationStopPosition(station) : station.position;
        this.sim.position = stopPos + (this.sim.isReversing ? -this.sim.trainHalfLength : this.sim.trainHalfLength);

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

        // Reset timers
        this.sim.stopWaitTime = 0;

        // Clear speech bubble on teleportation
        if (this.world.activePassengerForBubble) {
            this.world.activePassengerForBubble = null;
            if (this.world.bubbleTimeout) {
                clearTimeout(this.world.bubbleTimeout);
                this.world.bubbleTimeout = null;
            }
            if (this.world.speechBubble) {
                this.world.speechBubble.style.display = 'none';
            }
        }

        // Force update 3D meshes immediately
        this.trackManager.update(this.sim.position);
        this.updateTrunkVisibility();
        this.updateSwitchVisibility();
        this.stationModel.update(this.sim.position);
        this.trainModel.update(0);
        this.world.update(0, this.trainModel);

        // "Kurz vorladen, dann zeigen": die frisch eingeblendete Zielumgebung
        // sofort auf die GPU schieben, falls der Hintergrund-Lader sie noch nicht
        // erreicht hatte — verhindert einen Ruckler beim ersten Frame am Ziel.
        this._ensureResidentNow();

        // If orbit camera is active, update orbit controls target
        if (this.world.activeCameraType === 'orbit') {
            const activeCabCar = this.trainModel.carriages[this.sim.isReversing ? 3 : 0];
            const isG1 = (this.sim.trainModelType === 'G1');
            const carLength = isG1 ? 19.270 : 19.0;
            const cabLocalPos = this.sim.isReversing ? new THREE.Vector3(0, 2.00, -carLength + 1.2) : new THREE.Vector3(0, 2.00, -1.2);

            this.world.controls.target.copy(activeCabCar.localToWorld(cabLocalPos));
            this.world.controls.update();
        } else if (this.world.activeCameraType === 'platform') {
            // For platform view, re-initialize coordinates for the new station
            this.world.setCamera('platform');
        }
    }
}

// Instantiate App
window.addEventListener('DOMContentLoaded', () => {
    // Die Schriften werden programmatisch vorgeladen, damit sie sicher bereit
    // sind, BEVOR die Canvas-Texturen (Stationsschilder, Anzeigen) gezeichnet
    // werden — sonst rendern die Schilder mit der Fallback-Schrift.
    const jostFont = new FontFace('Jost Regular', 'url(./src/assets/Jost-Regular.ttf)');
    const dotoFont = new FontFace('Doto Bold', 'url(./src/assets/Doto-Bold.ttf)');
    const geistFont = new FontFace('Geist', 'url(./src/assets/Geist-Regular.ttf)');

    Promise.all([jostFont.load(), dotoFont.load(), geistFont.load()]).then((loadedFonts) => {
        loadedFonts.forEach(font => document.fonts.add(font));
        new App();
    }).catch((err) => {
        console.error("Failed to load fonts, starting app anyway:", err);
        new App();
    });
});
