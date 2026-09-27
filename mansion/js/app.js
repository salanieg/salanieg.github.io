
        import * as THREE from 'three';
        import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
        import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
        
        import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
        import { 
            getAuth, 
            signInWithEmailAndPassword, 
            signOut, 
            onAuthStateChanged 
        } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
        import {
            getFirestore,
            collection,
            addDoc,
            updateDoc,
            deleteDoc,
            doc as firestoreDoc,
            onSnapshot,
            serverTimestamp
        } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
        import { 
            getDatabase, 
            ref as rtdbRef, 
            set as rtdbSet, 
            update as rtdbUpdate, 
            remove as rtdbRemove, 
            onChildAdded, 
            onChildChanged, 
            onChildRemoved, 
            onDisconnect,
            onValue 
        } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

        // â”€â”€ FIREBASE KONFIGURATION â”€â”€
        const firebaseConfig = {
            apiKey: "AIzaSyBcCv-NlG0Z3jpQINEhbPQqBtMEDsDAthY",
            authDomain: "mansion-9fed1.firebaseapp.com",
            databaseURL: "https://mansion-9fed1-default-rtdb.europe-west1.firebasedatabase.app",
            projectId: "mansion-9fed1",
            storageBucket: "mansion-9fed1.firebasestorage.app",
            messagingSenderId: "904016895478",
            appId: "1:904016895478:web:b2c60e5da3f89eee72fbd7"
        };

        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);
        const rtdb = getDatabase(app);

        // Initialen Zustand der Chillen-Lampe fÃ¼r alle synchron abhÃ¶ren
        try {
            const initialLampRef = rtdbRef(rtdb, "worldState/chillenLamp");
            onValue(initialLampRef, (snapshot) => {
                const val = snapshot.val();
                if (val !== null && typeof val.isOn === "boolean") {
                    setChillenLampState(val.isOn, false);
                }
            });
        } catch (e) {
            console.warn("RTDB initial lamp listener error:", e);
        }

        // Initialen Zustand des Cinema-Screens fÃ¼r alle synchron abhÃ¶ren
        try {
            const initialCinemaRef = rtdbRef(rtdb, "worldState/cinema");
            onValue(initialCinemaRef, (snapshot) => {
                syncCinemaState(snapshot.val(), false);
            });
        } catch (e) {
            console.warn("RTDB initial cinema listener error:", e);
        }

        // Initialen Zustand der Lagerstuehle & Jetpacks fuer alle synchron abhoeren
        try {
            const initialChairsRef = rtdbRef(rtdb, "worldState/warehouseChairs");
            onValue(initialChairsRef, (snapshot) => {
                const val = snapshot.val();
                if (val && typeof val === "object") {
                    syncWarehouseChairsFromNetwork(val);
                }
            });

            const initialJetpacksRef = rtdbRef(rtdb, "worldState/warehouseJetpacks");
            onValue(initialJetpacksRef, (snapshot) => {
                const val = snapshot.val();
                if (val && typeof val === "object") {
                    syncWarehouseJetpacksFromNetwork(val);
                }
            });
        } catch (e) {
            console.warn("RTDB initial chairs/jetpacks listener error:", e);
        }

        // â”€â”€ DOM ELEMENTE â”€â”€
        const authContainer = document.getElementById("auth-container");
        const loadingState = document.getElementById("loading-state");
        const loginView = document.getElementById("login-view");
        const loginForm = document.getElementById("login-form");
        const emailInput = document.getElementById("email");
        const passwordInput = document.getElementById("password");
        const btnLogin = document.getElementById("btn-login");
        const btnLoginText = document.getElementById("btn-login-text");
        const btnLoginSpinner = document.getElementById("btn-login-spinner");
        const errorBox = document.getElementById("error-box");
        const errorText = document.getElementById("error-text");

        const gameContainer = document.getElementById("game-container");
        const gameCanvas = document.getElementById("game-canvas");
        const navUserEmail = document.getElementById("nav-user-email");
        const btnLogout = document.getElementById("btn-logout");
        const interactPrompt = document.getElementById("interact-prompt");

        // Modals & Settings
        const btnSettings = document.getElementById("btn-settings");
        const settingsModal = document.getElementById("settings-modal");
        const settingsNickname = document.getElementById("settings-nickname");
        const btnCancelSettings = document.getElementById("btn-cancel-settings");
        const btnSaveSettings = document.getElementById("btn-save-settings");
        const btnCamFirst = document.getElementById("btn-cam-first");
        const btnCamThird = document.getElementById("btn-cam-third");

        let isThirdPersonMode = localStorage.getItem("mansion_camera_mode") === "3rd";
        let tempThirdPersonChoice = isThirdPersonMode;
        let localPlayerGroup = null;
        let localPlayerJetpack = null;

        function updateCamButtonsUI(isThird) {
            if (btnCamFirst && btnCamThird) {
                if (isThird) {
                    btnCamFirst.style.background = "rgba(255,255,255,0.08)";
                    btnCamFirst.style.borderColor = "rgba(255,255,255,0.2)";
                    btnCamFirst.style.color = "#e4e4e7";
                    btnCamFirst.style.fontWeight = "normal";

                    btnCamThird.style.background = "#0284c7";
                    btnCamThird.style.borderColor = "#38bdf8";
                    btnCamThird.style.color = "#ffffff";
                    btnCamThird.style.fontWeight = "bold";
                } else {
                    btnCamFirst.style.background = "#0284c7";
                    btnCamFirst.style.borderColor = "#38bdf8";
                    btnCamFirst.style.color = "#ffffff";
                    btnCamFirst.style.fontWeight = "bold";

                    btnCamThird.style.background = "rgba(255,255,255,0.08)";
                    btnCamThird.style.borderColor = "rgba(255,255,255,0.2)";
                    btnCamThird.style.color = "#e4e4e7";
                    btnCamThird.style.fontWeight = "normal";
                }
            }
        }

        function setCameraMode(isThird) {
            isThirdPersonMode = isThird;
            localStorage.setItem("mansion_camera_mode", isThird ? "3rd" : "1st");
            if (localPlayerGroup) {
                localPlayerGroup.visible = isThird;
            }
            if (localJetpackCockpit) {
                localJetpackCockpit.visible = (!isThird && isJetpackEquipped);
            }
            updateCamButtonsUI(isThird);
        }

        // View Note Modal
        const viewNoteModal = document.getElementById("view-note-modal");
        const viewNoteMeta = document.getElementById("view-note-meta");
        const viewNoteBody = document.getElementById("view-note-body");
        const viewNoteImageContainer = document.getElementById("view-note-image-container");
        const viewNoteImage = document.getElementById("view-note-image");
        const btnCloseViewNote = document.getElementById("btn-close-view-note");
        const btnDeleteNote = document.getElementById("btn-delete-note");

        // Text Note Modal (Pinboard)
        const noteModal = document.getElementById("note-modal");
        const noteTextarea = document.getElementById("note-textarea");
        const btnCancelNote = document.getElementById("btn-cancel-note");
        const btnSaveNote = document.getElementById("btn-save-note");
        const btnSaveText = document.getElementById("btn-save-text");
        const btnSaveSpinner = document.getElementById("btn-save-spinner");

        // Art Image Note Modal (Art-Raum)
        const artNoteModal = document.getElementById("art-note-modal");
        const artFileInput = document.getElementById("art-file-input");
        const btnBrowseArt = document.getElementById("btn-browse-art");
        const artFileInfo = document.getElementById("art-file-info");
        const artPreviewWrapper = document.getElementById("art-preview-wrapper");
        const artPreviewImg = document.getElementById("art-preview-img");
        const artCompressInfo = document.getElementById("art-compress-info");
        const artCaptionInput = document.getElementById("art-caption-input");
        const btnCancelArt = document.getElementById("btn-cancel-art");
        const btnSaveArt = document.getElementById("btn-save-art");
        const btnSaveArtText = document.getElementById("btn-save-art-text");
        const btnSaveArtSpinner = document.getElementById("btn-save-art-spinner");

        // â”€â”€ STATE â”€â”€
        let currentUser = null;
        let unsubscribeNotes = null;
        let isModalOpen = false;
        let currentInteractTarget = null; // { type: 'note' | 'seat' | 'pinboard' | 'artWall', ... }
        let savedPinTarget = null;
        const notesMeshMap = new Map(); // id -> THREE.Mesh

        // Sitzen & Interaktion
        const seats = []; // { mesh, name, sitPos, lookDir }
        const seatMeshes = []; // Meshes fÃ¼r Raycast
        let isSitting = false;
        let currentSeat = null;

        // Pinboards (Notizbereiche)
        const pinboardMeshes = [];

        // Springen & Physik
        let velocityY = 0;
        let isOnGround = true;
        const GRAVITY = -22;
        const JUMP_STRENGTH = 7.5;

        // Komprimiertes Bild im Art-Modal
        let compressedArtData = null;

        // â”€â”€ PROCEDURAL CARPET FOOTSTEP AUDIO (Web Audio API) â”€â”€
        class CarpetFootstepAudio {
            constructor() {
                this.ctx = null;
                this.stepTimer = 0;
                this.stepInterval = 0.38; // Passend zur Laufgeschwindigkeit
                this.isLeftFoot = true;
            }

            init() {
                if (!this.ctx) {
                    const AudioContext = window.AudioContext || window.webkitAudioContext;
                    if (AudioContext) {
                        this.ctx = new AudioContext();
                    }
                }
                if (this.ctx && this.ctx.state === 'suspended') {
                    this.ctx.resume().catch(() => {});
                }
            }

            playStep() {
                if (!this.ctx) this.init();
                if (!this.ctx) return;
                if (this.ctx.state === 'suspended') {
                    this.ctx.resume().catch(() => {});
                }

                const t = this.ctx.currentTime;
                const panVal = this.isLeftFoot ? -0.15 : 0.15;
                this.isLeftFoot = !this.isLeftFoot;

                let dest = this.ctx.destination;
                if (this.ctx.createStereoPanner) {
                    const panner = this.ctx.createStereoPanner();
                    panner.pan.setValueAtTime(panVal, t);
                    panner.connect(dest);
                    dest = panner;
                }

                // 1. Weicher dumpfer Teppich-Aufprall (Muffled Bass Thud: 55-90 Hz)
                const osc = this.ctx.createOscillator();
                const oscGain = this.ctx.createGain();
                const baseFreq = 70 + Math.random() * 15;
                osc.frequency.setValueAtTime(baseFreq, t);
                osc.frequency.exponentialRampToValueAtTime(32, t + 0.08);

                oscGain.gain.setValueAtTime(0.20 + Math.random() * 0.04, t);
                oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.085);

                osc.connect(oscGain);
                oscGain.connect(dest);
                osc.start(t);
                osc.stop(t + 0.09);

                // 2. Weiches Teppichfaser-GerÃ¤usch (Low-pass filtered noise)
                const bufferSize = Math.floor(this.ctx.sampleRate * 0.07);
                const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) {
                    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.28));
                }

                const noise = this.ctx.createBufferSource();
                noise.buffer = buffer;

                const filter = this.ctx.createBiquadFilter();
                filter.type = "lowpass";
                filter.frequency.setValueAtTime(420 + Math.random() * 80, t);

                const noiseGain = this.ctx.createGain();
                noiseGain.gain.setValueAtTime(0.14 + Math.random() * 0.03, t);
                noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);

                noise.connect(filter);
                filter.connect(noiseGain);
                noiseGain.connect(dest);

                noise.start(t);
                noise.stop(t + 0.075);
            }

            update(delta, isMoving, onGround, sitting) {
                if (!isMoving || !onGround || sitting) {
                    this.stepTimer = 0.12;
                    return;
                }

                this.stepTimer += delta;
                if (this.stepTimer >= this.stepInterval) {
                    this.playStep();
                    this.stepTimer = 0;
                }
            }
        }

        const footstepAudio = new CarpetFootstepAudio();

        // â”€â”€ JETPACK PROZEDURALES WEB AUDIO SYSTEM (SANFTER JETSOUND, NICHT ZU LAUT) â”€â”€
        class JetpackAudio {
            constructor() {
                this.ctx = null;
                this.isThrusting = false;
                this.gainNode = null;
                this.noiseSource = null;
                this.subOsc = null;
            }

            init(audioCtx) {
                if (!audioCtx) return;
                this.ctx = audioCtx;

                try {
                    this.gainNode = this.ctx.createGain();
                    this.gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
                    this.gainNode.connect(this.ctx.destination);

                    // Gefiltertes Rauschen fÃ¼r sanftes Triebwerkszischen
                    const bufferSize = Math.floor(this.ctx.sampleRate * 1.5);
                    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
                    const data = buffer.getChannelData(0);
                    for (let i = 0; i < bufferSize; i++) {
                        data[i] = (Math.random() * 2 - 1) * 0.35;
                    }

                    this.noiseSource = this.ctx.createBufferSource();
                    this.noiseSource.buffer = buffer;
                    this.noiseSource.loop = true;

                    const bandpass = this.ctx.createBiquadFilter();
                    bandpass.type = "bandpass";
                    bandpass.frequency.value = 460;
                    bandpass.Q.value = 1.4;

                    const lowpass = this.ctx.createBiquadFilter();
                    lowpass.type = "lowpass";
                    lowpass.frequency.value = 1100;

                    this.noiseSource.connect(bandpass);
                    bandpass.connect(lowpass);
                    lowpass.connect(this.gainNode);
                    this.noiseSource.start(0);

                    // Sub-Bass Oszillator (60 Hz) fÃ¼r tiefes Triebwerksgrollen
                    this.subOsc = this.ctx.createOscillator();
                    this.subOsc.type = "sine";
                    this.subOsc.frequency.value = 60;

                    const subGain = this.ctx.createGain();
                    subGain.gain.value = 0.20;

                    this.subOsc.connect(subGain);
                    subGain.connect(this.gainNode);
                    this.subOsc.start(0);
                } catch (err) {
                    console.warn("Jetpack audio init warning:", err);
                }
            }

            setThrust(active) {
                if (!this.ctx && footstepAudio && footstepAudio.ctx) {
                    this.init(footstepAudio.ctx);
                }
                if (!this.ctx || !this.gainNode) return;
                if (this.ctx.state === "suspended") {
                    this.ctx.resume().catch(() => {});
                }

                const now = this.ctx.currentTime;
                if (active) {
                    if (!this.isThrusting) {
                        this.isThrusting = true;
                        // Angenehme, dezente LautstÃ¤rke (~0.14) mit sanftem 0.08s Anschwellen
                        this.gainNode.gain.cancelScheduledValues(now);
                        this.gainNode.gain.setTargetAtTime(0.14, now, 0.08);
                    }
                } else {
                    if (this.isThrusting) {
                        this.isThrusting = false;
                        // Sanftes Ausklingen (0.12s)
                        this.gainNode.gain.cancelScheduledValues(now);
                        this.gainNode.gain.setTargetAtTime(0.0001, now, 0.12);
                    }
                }
            }
        }

        const jetpackAudio = new JetpackAudio();

        // â”€â”€ NOTIZ-VERSCHIEBEN STATUSVARIABLEN â”€â”€
        let movingNoteState = null; // { noteId, data, mesh, ghostFrame, isImage, validTarget }

        // â”€â”€ FAHRRAD & JETPACK STATUSVARIABLEN â”€â”€
        let isRidingBike = false;
        let worldBikeGroup = null;
        let bikeInteractMesh = null;
        let localBikeCockpit = null;
        let skyDomeMesh = null;
        let skyUniforms = null;

        // â”€â”€ CHILLEN-LAMPE & STERNENHIMMEL STATUSVARIABLEN â”€â”€
        let isChillenLampOn = false;

        // â”€â”€ VIEWING SCREEN & CSS3D STATUSVARIABLEN â”€â”€
        let cinemaScreenMesh = null;
        let cinemaInteractMesh = null;
        let cssScene = null;
        let cssRenderer = null;
        let cssCinemaObject = null;
        let ytPlayer = null;
        let ytPlayerDuration = 0;
        let ytPlayerReady = false;
        let ytApiReady = false;
        let ytApiLoading = false;
        let loadedCinemaVideoId = null;
        let lastLocalCinemaTimestamp = 0;
        let cinemaRtdbWritable = true;
        let cinemaIframe = null;
        let projectorBeamMesh = null;
        let projectorFlareMesh = null;
        let projectorLedMesh = null;
        let currentCinemaVideoId = null;
        let currentCinemaPlaying = false;
        let currentCinemaStartedAt = 0;
        let currentCinemaSeekSec = 0;

        // ── KINO BEDIENPULT 3D VARIABLEN ──
        let cinemaControlMeshes = [];
        let btnLinkMesh = null;
        let btnStartMesh = null;
        let btnBack15Mesh = null;
        let btnPlayPauseMesh = null;
        let btnFwd15Mesh = null;
        let timeDisplayMesh = null;
        let timeDisplayCanvas = null;
        let timeDisplayCtx = null;
        let timeDisplayTexture = null;
        let scrubberTrackMesh = null;
        let scrubberFillMesh = null;
        let scrubberKnobMesh = null;
        let panelLedMesh = null;
        let lastDrawnSec = -1;
        let lastDrawnPlaying = null;
        let hoveredControlMesh = null;

        // ── LAGER & VERSCHIEBBARE STUEHLE STATE ──
        let warehouseChairs = []; // [{ id, group, seatMesh, seat, defaultPos: {x, z, rotY} }]
        let warehouseResetButtonMesh = null;
        let movingChairState = null; // { chairObj, ghostGroup, currentRotY, validTarget }
        let isResettingChairs = false;
        let warehouseLampBeamMesh = null;
        let warehouseMosquitoes = null;
        let isCinemaModalOpen = false;

        function ensureYouTubeAPI(cb) {
            if (window.YT && typeof window.YT.Player === 'function') {
                ytApiReady = true;
                if (cb) cb();
                return;
            }
            if (ytApiReady) { if (cb) cb(); return; }

            window._ytReadyCbs = (window._ytReadyCbs || []);
            if (cb) window._ytReadyCbs.push(cb);

            if (ytApiLoading) return;
            ytApiLoading = true;

            const checkTimer = setInterval(() => {
                if (window.YT && typeof window.YT.Player === 'function') {
                    clearInterval(checkTimer);
                    ytApiReady = true;
                    ytApiLoading = false;
                    const cbs = window._ytReadyCbs || [];
                    window._ytReadyCbs = [];
                    cbs.forEach(fn => { try { fn(); } catch(e) { console.warn("YT cb err:", e); } });
                }
            }, 50);

            const prevHandler = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = function() {
                clearInterval(checkTimer);
                ytApiReady = true;
                ytApiLoading = false;
                if (typeof prevHandler === 'function') prevHandler();
                const cbs = window._ytReadyCbs || [];
                window._ytReadyCbs = [];
                cbs.forEach(fn => { try { fn(); } catch(e) { console.warn("YT cb err:", e); } });
            };

            if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
                const s = document.createElement('script');
                s.src = 'https://www.youtube.com/iframe_api';
                document.head.appendChild(s);
            }
        }

        function parseYouTubeId(raw) {
            if (!raw) return null;
            raw = raw.trim();
            if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
            const match = raw.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|live\/|shorts\/))([A-Za-z0-9_-]{11})/i);
            if (match && match[1]) return match[1];
            try {
                const u = new URL(raw.startsWith('http') ? raw : 'https://' + raw);
                if (u.searchParams && u.searchParams.get('v')) return u.searchParams.get('v');
                const parts = u.pathname.split('/').filter(Boolean);
                const last = parts[parts.length - 1];
                if (last && /^[A-Za-z0-9_-]{11}$/.test(last)) return last;
            } catch (e) {}
            return null;
        }

        function formatTime(sec) {
            if (!sec || isNaN(sec) || sec < 0) sec = 0;
            const m = Math.floor(sec / 60);
            const s = Math.floor(sec % 60).toString().padStart(2, '0');
            return `${m}:${s}`;
        }

        function setControlMeshEmissive(mesh, hex, intensity = 0.35) {
            if (!mesh) return;
            if (Array.isArray(mesh.material)) {
                // Nur die beschriftete Vorderseite (Index 4) hervorheben, damit seitliche Kanten neutral bleiben
                const frontMat = mesh.material[4] || mesh.material[0];
                if (frontMat && frontMat.emissive) {
                    frontMat.emissive.setHex(hex);
                    frontMat.emissiveIntensity = intensity;
                }
            } else if (mesh.material && mesh.material.emissive) {
                mesh.material.emissive.setHex(hex);
                mesh.material.emissiveIntensity = intensity;
            }
        }

        function renderPlayPauseButtonTexture(btnMesh, isPlaying) {
            if (!btnMesh || !btnMesh.userData || !btnMesh.userData.ctx) return;
            const ctx = btnMesh.userData.ctx;
            const w = 480;
            const h = 160;

            // 1. Strahlender gebürsteter Edelstahl (anisotroper Verlauf)
            const grad = ctx.createLinearGradient(0, 0, 0, h);
            grad.addColorStop(0.0, "#ffffff");
            grad.addColorStop(0.20, "#f8fafc");
            grad.addColorStop(0.48, "#e2e8f0");
            grad.addColorStop(0.55, "#cbd5e1");
            grad.addColorStop(0.80, "#e2e8f0");
            grad.addColorStop(1.0, "#f8fafc");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, w, h);

            // 2. Feine metallische Bürstlinien
            ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
            for (let y = 4; y < h - 4; y += 4) ctx.fillRect(0, y, w, 1.5);
            ctx.fillStyle = "rgba(15, 23, 42, 0.04)";
            for (let y = 6; y < h - 4; y += 4) ctx.fillRect(0, y, w, 1);

            // 3. Präzise gefräste Kantenfase (Highlight oben/links, Schatten unten/rechts)
            ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
            ctx.lineWidth = 3;
            ctx.strokeRect(2, 2, w - 4, h - 4);
            ctx.strokeStyle = "rgba(15, 23, 42, 0.25)";
            ctx.lineWidth = 1.5;
            ctx.strokeRect(5, 5, w - 10, h - 10);

            // 4. Zentrierte, minimalistische Lasergravur
            ctx.save();
            ctx.shadowColor = "rgba(255, 255, 255, 0.85)";
            ctx.shadowOffsetY = 1.5;
            ctx.shadowBlur = 1;
            ctx.fillStyle = "#0f172a";

            const cx = w / 2;
            const cy = h / 2;

            if (isPlaying) {
                // Minimalistische Pause-Balken: ❚❚
                const barW = 16;
                const barH = 58;
                const gap = 16;
                ctx.fillRect(cx - barW - gap / 2, cy - barH / 2, barW, barH);
                ctx.fillRect(cx + gap / 2, cy - barH / 2, barW, barH);
            } else {
                // Minimalistisches Play-Dreieck: ▶
                ctx.beginPath();
                ctx.moveTo(cx - 18, cy - 30);
                ctx.lineTo(cx + 24, cy);
                ctx.lineTo(cx - 18, cy + 30);
                ctx.closePath();
                ctx.fill();
            }
            ctx.restore();

            btnMesh.userData.texture.needsUpdate = true;
        }

        function renderTimeDisplayTexture(elapsed, duration, isPlaying) {
            if (!timeDisplayCtx || !timeDisplayTexture) return;
            const ctx = timeDisplayCtx;
            const w = 1024;
            const h = 128;

            // Tiefschwarzes Mineralglas-Display
            ctx.fillStyle = "#020617";
            ctx.fillRect(0, 0, w, h);

            // Subtile Display-Innenfase
            ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
            ctx.lineWidth = 2.5;
            ctx.strokeRect(2, 2, w - 4, h - 4);

            const hasVideo = Boolean(currentCinemaVideoId);
            const timeStr = hasVideo ? `${formatTime(elapsed)} / ${formatTime(duration)}` : "--:-- / --:--";

            // Präzise zentrierte Ziffernanzeige im cleanen Ice-Cyan
            ctx.fillStyle = "#7dd3fc";
            ctx.font = '700 52px "Quicksand", monospace, sans-serif';
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(timeStr, w / 2, h / 2);

            timeDisplayTexture.needsUpdate = true;
        }

        function updateControlPanelDisplay() {
            if (!scrubberTrackMesh) return;

            let elapsed = 0;
            let duration = 0;
            if (ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
                try {
                    elapsed = ytPlayer.getCurrentTime() || 0;
                    duration = ytPlayerDuration || ytPlayer.getDuration() || 0;
                } catch(e) {}
            } else if (currentCinemaStartedAt > 0 && currentCinemaPlaying) {
                elapsed = (Date.now() - currentCinemaStartedAt) / 1000;
            } else {
                elapsed = currentCinemaSeekSec || 0;
            }

            const curSec = Math.floor(elapsed);
            if (curSec !== lastDrawnSec || currentCinemaPlaying !== lastDrawnPlaying) {
                lastDrawnSec = curSec;
                lastDrawnPlaying = currentCinemaPlaying;
                renderTimeDisplayTexture(elapsed, duration, currentCinemaPlaying);
                if (btnPlayPauseMesh) {
                    renderPlayPauseButtonTexture(btnPlayPauseMesh, currentCinemaPlaying);
                }
                if (panelLedMesh) {
                    panelLedMesh.material.color.setHex(currentCinemaPlaying ? 0x22c55e : (currentCinemaVideoId ? 0xf59e0b : 0x64748b));
                    panelLedMesh.material.emissive.setHex(currentCinemaPlaying ? 0x22c55e : (currentCinemaVideoId ? 0xf59e0b : 0x64748b));
                }
            }

            const pct = duration > 0 ? Math.min(1.0, Math.max(0.0, elapsed / duration)) : 0.0;
            const trackWidth = scrubberTrackMesh.userData.trackWidth || 1.08;
            const usableTrack = trackWidth - 0.04;

            if (scrubberFillMesh) {
                scrubberFillMesh.scale.x = Math.max(0.001, pct);
            }
            if (scrubberKnobMesh) {
                scrubberKnobMesh.position.x = -usableTrack / 2 + usableTrack * pct;
            }
        }

        function handleCinemaControlClick(action, seekTime, mesh) {
            // 3D-Button Einpress-Effekt
            if (mesh && typeof mesh.userData.initialZ === 'number') {
                mesh.position.z = mesh.userData.initialZ - 0.015;
                setTimeout(() => {
                    if (mesh) mesh.position.z = mesh.userData.initialZ;
                }, 120);
            }

            if (action === 'link') {
                openCinemaQuickModal();
            } else if (action === 'start') {
                if (currentCinemaVideoId) {
                    pushCinemaState(currentCinemaVideoId, true, 0);
                } else {
                    openCinemaQuickModal();
                }
            } else if (action === 'back15') {
                if (!currentCinemaVideoId) return;
                let cur = 0;
                if (ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
                    try { cur = ytPlayer.getCurrentTime() || 0; } catch(e) {}
                } else {
                    cur = currentCinemaSeekSec || 0;
                }
                const target = Math.max(0, cur - 15);
                pushCinemaState(currentCinemaVideoId, currentCinemaPlaying, target);
            } else if (action === 'playpause') {
                if (!currentCinemaVideoId) {
                    openCinemaQuickModal();
                    return;
                }
                let cur = 0;
                if (ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
                    try { cur = ytPlayer.getCurrentTime() || 0; } catch(e) {}
                } else {
                    cur = currentCinemaSeekSec || 0;
                }
                const nextPlaying = !currentCinemaPlaying;
                pushCinemaState(currentCinemaVideoId, nextPlaying, cur);
            } else if (action === 'fwd15') {
                if (!currentCinemaVideoId) return;
                let cur = 0;
                if (ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
                    try { cur = ytPlayer.getCurrentTime() || 0; } catch(e) {}
                } else {
                    cur = currentCinemaSeekSec || 0;
                }
                const dur = ytPlayerDuration || 3600;
                const target = Math.min(dur, cur + 15);
                pushCinemaState(currentCinemaVideoId, currentCinemaPlaying, target);
            } else if (action === 'scrubber') {
                if (!currentCinemaVideoId || typeof seekTime !== 'number') return;
                pushCinemaState(currentCinemaVideoId, currentCinemaPlaying, seekTime);
            }
        }

        function handleCinemaScreenClick() {
            if (!currentCinemaVideoId) {
                openCinemaQuickModal();
            } else {
                let cur = 0;
                if (ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
                    try { cur = ytPlayer.getCurrentTime() || 0; } catch(e) {}
                } else {
                    cur = currentCinemaSeekSec || 0;
                }
                const nextPlaying = !currentCinemaPlaying;
                pushCinemaState(currentCinemaVideoId, nextPlaying, cur);
                if (ytPlayer) {
                    try {
                        if (nextPlaying && typeof ytPlayer.playVideo === 'function') {
                            if (ytPlayer.isMuted && ytPlayer.isMuted()) ytPlayer.unMute();
                            ytPlayer.playVideo();
                        } else if (!nextPlaying && typeof ytPlayer.pauseVideo === 'function') {
                            ytPlayer.pauseVideo();
                        }
                    } catch(e) {}
                }
            }
        }

        function createChassisCanvasTexture() {
            const canvas = document.createElement("canvas");
            canvas.width = 1024;
            canvas.height = 546;
            const ctx = canvas.getContext("2d");

            // 1. Strahlender gebürsteter Edelstahl (anisotroper Verlauf über das gesamte Chassis)
            const grad = ctx.createLinearGradient(0, 0, 1024, 546);
            grad.addColorStop(0.0, "#ffffff");
            grad.addColorStop(0.15, "#f8fafc");
            grad.addColorStop(0.40, "#e2e8f0");
            grad.addColorStop(0.52, "#cbd5e1");
            grad.addColorStop(0.68, "#e2e8f0");
            grad.addColorStop(0.90, "#f8fafc");
            grad.addColorStop(1.0, "#e2e8f0");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 1024, 546);

            // 2. Horizontale Mikro-Bürstlinien (240er-Schliff)
            for (let y = 0; y < 546; y += 3) {
                const alphaL = 0.06 + Math.random() * 0.08;
                ctx.fillStyle = `rgba(255, 255, 255, ${alphaL})`;
                ctx.fillRect(0, y, 1024, 1.5);

                const alphaD = 0.02 + Math.random() * 0.04;
                ctx.fillStyle = `rgba(15, 23, 42, ${alphaD})`;
                ctx.fillRect(0, y + 1.5, 1024, 1);
            }

            // 3. Präzise gefräste Plattenfase
            ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
            ctx.lineWidth = 4;
            ctx.strokeRect(3, 3, 1018, 540);

            ctx.strokeStyle = "rgba(15, 23, 42, 0.25)";
            ctx.lineWidth = 2;
            ctx.strokeRect(8, 8, 1008, 530);

            // 4. Vier bündig eingelassene Sechskant-Edelstahlschrauben in den Ecken
            const screws = [
                [36, 36],
                [1024 - 36, 36],
                [36, 546 - 36],
                [1024 - 36, 546 - 36]
            ];
            screws.forEach(([sx, sy]) => {
                ctx.save();
                // Äußere Vertiefung
                ctx.beginPath();
                ctx.arc(sx, sy, 13, 0, Math.PI * 2);
                ctx.fillStyle = "#94a3b8";
                ctx.fill();
                ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
                ctx.lineWidth = 2;
                ctx.stroke();

                // Schraubenkopf
                ctx.beginPath();
                ctx.arc(sx, sy, 10, 0, Math.PI * 2);
                ctx.fillStyle = "#cbd5e1";
                ctx.fill();
                ctx.strokeStyle = "rgba(15, 23, 42, 0.4)";
                ctx.lineWidth = 1.5;
                ctx.stroke();

                // Innensechskant (Allen-Key)
                ctx.beginPath();
                for (let i = 0; i < 6; i++) {
                    const angle = (i * Math.PI) / 3 + 0.2;
                    const hx = sx + Math.cos(angle) * 5;
                    const hy = sy + Math.sin(angle) * 5;
                    if (i === 0) ctx.moveTo(hx, hy);
                    else ctx.lineTo(hx, hy);
                }
                ctx.closePath();
                ctx.fillStyle = "#334155";
                ctx.fill();
                ctx.restore();
            });

            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.needsUpdate = true;
            return texture;
        }

        function createButtonCanvasTexture(actionType) {
            const canvas = document.createElement("canvas");
            canvas.width = 512;
            canvas.height = 160;
            const ctx = canvas.getContext("2d");

            // 1. Strahlender gebürsteter Edelstahl (anisotroper Verlauf)
            const grad = ctx.createLinearGradient(0, 0, 0, 160);
            grad.addColorStop(0.0, "#ffffff");
            grad.addColorStop(0.20, "#f8fafc");
            grad.addColorStop(0.48, "#e2e8f0");
            grad.addColorStop(0.55, "#cbd5e1");
            grad.addColorStop(0.80, "#e2e8f0");
            grad.addColorStop(1.0, "#f8fafc");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 512, 160);

            // 2. Feine metallische Bürstlinien
            ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
            for (let y = 4; y < 156; y += 4) ctx.fillRect(0, y, 512, 1.5);
            ctx.fillStyle = "rgba(15, 23, 42, 0.04)";
            for (let y = 6; y < 156; y += 4) ctx.fillRect(0, y, 512, 1);

            // 3. Präzise gefräste Kantenfase
            ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
            ctx.lineWidth = 3;
            ctx.strokeRect(2, 2, 508, 156);
            ctx.strokeStyle = "rgba(15, 23, 42, 0.25)";
            ctx.lineWidth = 1.5;
            ctx.strokeRect(5, 5, 502, 150);

            // 4. Zentrierte, minimalistische Lasergravur (reine Vektor-Symbole, keine veralteten Wörter)
            ctx.save();
            ctx.shadowColor = "rgba(255, 255, 255, 0.85)";
            ctx.shadowOffsetY = 1.5;
            ctx.shadowBlur = 1;

            const cx = 256;
            const cy = 80;

            if (actionType === "link") {
                // Minimalistisches Ketten-Link Symbol (interlocking links)
                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate(-Math.PI / 4);
                ctx.strokeStyle = "#0f172a";
                ctx.lineWidth = 7.5;
                ctx.lineCap = "round";

                // Link 1 (links)
                ctx.beginPath();
                ctx.moveTo(-6, -16);
                ctx.lineTo(-20, -16);
                ctx.arcTo(-36, -16, -36, 0, 16);
                ctx.arcTo(-36, 16, -20, 16, 16);
                ctx.lineTo(-6, 16);
                ctx.stroke();

                // Link 2 (rechts)
                ctx.beginPath();
                ctx.moveTo(6, -16);
                ctx.lineTo(20, -16);
                ctx.arcTo(36, -16, 36, 0, 16);
                ctx.arcTo(36, 16, 20, 16, 16);
                ctx.lineTo(6, 16);
                ctx.stroke();

                // Verbindungssteg
                ctx.beginPath();
                ctx.moveTo(-10, 0);
                ctx.lineTo(10, 0);
                ctx.stroke();
                ctx.restore();
            } else if (actionType === "start") {
                // Minimalistisches Start / Video-Playback Symbol (Präziser Kreis mit zentriertem Play-Dreieck)
                ctx.save();
                ctx.translate(cx, cy);
                ctx.strokeStyle = "#0f172a";
                ctx.lineWidth = 6;
                ctx.beginPath();
                ctx.arc(0, 0, 38, 0, Math.PI * 2);
                ctx.stroke();

                ctx.fillStyle = "#0f172a";
                ctx.beginPath();
                ctx.moveTo(-11, -20);
                ctx.lineTo(19, 0);
                ctx.lineTo(-11, 20);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            } else if (actionType === "back15") {
                // Minimalistisches Rewind 15s (gebogener Umlauf-Pfeil mit zentriertem 15)
                ctx.save();
                ctx.translate(cx, cy);
                ctx.strokeStyle = "#0f172a";
                ctx.lineWidth = 6;
                ctx.lineCap = "round";
                ctx.beginPath();
                ctx.arc(0, 0, 40, -Math.PI * 0.25, Math.PI * 1.35);
                ctx.stroke();

                // Pfeilspitze
                const tipAngle = -Math.PI * 0.25;
                const ax = Math.cos(tipAngle) * 40;
                const ay = Math.sin(tipAngle) * 40;
                ctx.fillStyle = "#0f172a";
                ctx.beginPath();
                ctx.moveTo(ax + 10, ay - 8);
                ctx.lineTo(ax - 13, ay - 3);
                ctx.lineTo(ax - 2, ay + 13);
                ctx.closePath();
                ctx.fill();

                ctx.font = '700 34px "Quicksand", system-ui, sans-serif';
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillStyle = "#0f172a";
                ctx.fillText("15", 0, 2);
                ctx.restore();
            } else if (actionType === "fwd15") {
                // Minimalistisches Forward 15s (exakt horizontal gespiegelter Vorlauf-Pfeil mit zentriertem 15)
                ctx.save();
                ctx.translate(cx, cy);

                // Pfeilbogen gespiegelt im Uhrzeigersinn
                ctx.save();
                ctx.scale(-1, 1);
                ctx.strokeStyle = "#0f172a";
                ctx.lineWidth = 6;
                ctx.lineCap = "round";
                ctx.beginPath();
                ctx.arc(0, 0, 40, -Math.PI * 0.25, Math.PI * 1.35);
                ctx.stroke();

                // Pfeilspitze
                const tipAngle = -Math.PI * 0.25;
                const ax = Math.cos(tipAngle) * 40;
                const ay = Math.sin(tipAngle) * 40;
                ctx.fillStyle = "#0f172a";
                ctx.beginPath();
                ctx.moveTo(ax + 10, ay - 8);
                ctx.lineTo(ax - 13, ay - 3);
                ctx.lineTo(ax - 2, ay + 13);
                ctx.closePath();
                ctx.fill();
                ctx.restore();

                // Ungespiegelte Ziffer "15" exakt in der Mitte
                ctx.font = '700 34px "Quicksand", system-ui, sans-serif';
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillStyle = "#0f172a";
                ctx.fillText("15", 0, 2);
                ctx.restore();
            }
            ctx.restore();

            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.needsUpdate = true;
            return { texture, canvas, ctx };
        }

        function createCinemaControlPanel(rx, rz, dRot) {
            cinemaControlMeshes = [];
            const panelGroup = new THREE.Group();

            // Position an der Wand rechts neben der Leinwand:
            const theta = -2.40;
            const radius = 5.37;
            const dx = radius * Math.cos(theta);
            const dz = radius * Math.sin(theta);

            function rot(x, z) {
                const c = Math.cos(dRot), s = Math.sin(dRot);
                return { x: x * c + z * s, z: -x * s + z * c };
            }
            const rP = rot(dx, dz);
            panelGroup.position.set(rx + rP.x, 1.80, rz + rP.z);
            panelGroup.rotation.y = Math.atan2(-dx, -dz) + dRot;

            // 1. Gehäuse: Vollständiger Edelstahl-Look (Brushed Stainless Steel Plate)
            const chassisWidth = 1.16;
            const chassisHeight = 0.62;
            const chassisDepth = 0.038;

            const chassisTex = createChassisCanvasTexture();
            const chassisFrontMat = new THREE.MeshStandardMaterial({
                map: chassisTex,
                roughness: 0.32,
                metalness: 0.25
            });
            const chassisSideMat = new THREE.MeshStandardMaterial({
                color: 0xecf0f5,
                roughness: 0.32,
                metalness: 0.25
            });
            const chassisMesh = new THREE.Mesh(
                new THREE.BoxGeometry(chassisWidth, chassisHeight, chassisDepth),
                [chassisSideMat, chassisSideMat, chassisSideMat, chassisSideMat, chassisFrontMat, chassisSideMat]
            );
            panelGroup.add(chassisMesh);

            // Äußerer polierter Edelstahlrahmen mit Facette
            const frameMat = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                roughness: 0.20,
                metalness: 0.35
            });
            const frameOuter = new THREE.Mesh(
                new THREE.BoxGeometry(chassisWidth + 0.024, chassisHeight + 0.024, 0.012),
                frameMat
            );
            frameOuter.position.z = -0.015;
            panelGroup.add(frameOuter);

            // Dezente Status-LED oben rechts (minimalistischer Pinhole-Indikator)
            const ledGeo = new THREE.SphereGeometry(0.010, 16, 12);
            const ledMat = new THREE.MeshStandardMaterial({
                color: 0x64748b,
                emissive: 0x64748b,
                emissiveIntensity: 0.6,
                roughness: 0.2,
                metalness: 0.35
            });
            panelLedMesh = new THREE.Mesh(ledGeo, ledMat);
            panelLedMesh.position.set(0.50, 0.25, chassisDepth / 2 + 0.005);
            panelGroup.add(panelLedMesh);

            // Gemeinsames Edelstahlmaterial für alle Kanten der 3D-Buttons (KEINE Textur auf den Seitenkanten!)
            const steelSideMat = new THREE.MeshStandardMaterial({
                color: 0xecf0f5,
                roughness: 0.30,
                metalness: 0.25
            });

            // ── ZEILE 1: [Link] [Start-Button] ──
            const row1Y = 0.14;
            const b1W = 0.50;
            const b1H = 0.11;
            const bDepth = 0.020;
            const btnZ = chassisDepth / 2 + bDepth / 2;

            // [Link]
            const linkObj = createButtonCanvasTexture("link");
            const btnLinkFrontMat = new THREE.MeshStandardMaterial({
                map: linkObj.texture,
                roughness: 0.28,
                metalness: 0.25
            });
            btnLinkMesh = new THREE.Mesh(
                new THREE.BoxGeometry(b1W, b1H, bDepth),
                [steelSideMat, steelSideMat, steelSideMat, steelSideMat, btnLinkFrontMat, steelSideMat]
            );
            btnLinkMesh.position.set(-0.27, row1Y, btnZ);
            btnLinkMesh.userData = {
                action: 'link',
                initialZ: btnZ,
                promptText: '[LMB] Link eingeben'
            };
            panelGroup.add(btnLinkMesh);
            cinemaControlMeshes.push(btnLinkMesh);

            // [Start-Button]
            const startObj = createButtonCanvasTexture("start");
            const btnStartFrontMat = new THREE.MeshStandardMaterial({
                map: startObj.texture,
                roughness: 0.28,
                metalness: 0.25
            });
            btnStartMesh = new THREE.Mesh(
                new THREE.BoxGeometry(b1W, b1H, bDepth),
                [steelSideMat, steelSideMat, steelSideMat, steelSideMat, btnStartFrontMat, steelSideMat]
            );
            btnStartMesh.position.set(0.27, row1Y, btnZ);
            btnStartMesh.userData = {
                action: 'start',
                initialZ: btnZ,
                promptText: '[LMB] Video starten'
            };
            panelGroup.add(btnStartMesh);
            cinemaControlMeshes.push(btnStartMesh);

            // ── ZEILE 2: [-15s] [Play/Pause] [+15s] ──
            const row2Y = 0.00;
            const b2W = 0.32;
            const b2H = 0.11;

            // [-15s]
            const backObj = createButtonCanvasTexture("back15");
            const btnBackFrontMat = new THREE.MeshStandardMaterial({
                map: backObj.texture,
                roughness: 0.28,
                metalness: 0.25
            });
            btnBack15Mesh = new THREE.Mesh(
                new THREE.BoxGeometry(b2W, b2H, bDepth),
                [steelSideMat, steelSideMat, steelSideMat, steelSideMat, btnBackFrontMat, steelSideMat]
            );
            btnBack15Mesh.position.set(-0.36, row2Y, btnZ);
            btnBack15Mesh.userData = {
                action: 'back15',
                initialZ: btnZ,
                promptText: '[LMB] -15s'
            };
            panelGroup.add(btnBack15Mesh);
            cinemaControlMeshes.push(btnBack15Mesh);

            // [Play/Pause]
            const ppCanvas = document.createElement("canvas");
            ppCanvas.width = 480;
            ppCanvas.height = 160;
            const ppCtx = ppCanvas.getContext("2d");
            const ppTex = new THREE.CanvasTexture(ppCanvas);
            ppTex.colorSpace = THREE.SRGBColorSpace;
            const btnPlayPauseFrontMat = new THREE.MeshStandardMaterial({
                map: ppTex,
                roughness: 0.28,
                metalness: 0.25
            });
            btnPlayPauseMesh = new THREE.Mesh(
                new THREE.BoxGeometry(0.36, b2H, bDepth),
                [steelSideMat, steelSideMat, steelSideMat, steelSideMat, btnPlayPauseFrontMat, steelSideMat]
            );
            btnPlayPauseMesh.position.set(0.00, row2Y, btnZ);
            btnPlayPauseMesh.userData = {
                action: 'playpause',
                initialZ: btnZ,
                ctx: ppCtx,
                texture: ppTex,
                promptText: '[LMB] Play / Pause'
            };
            renderPlayPauseButtonTexture(btnPlayPauseMesh, false);
            panelGroup.add(btnPlayPauseMesh);
            cinemaControlMeshes.push(btnPlayPauseMesh);

            // [+15s]
            const fwdObj = createButtonCanvasTexture("fwd15");
            const btnFwdFrontMat = new THREE.MeshStandardMaterial({
                map: fwdObj.texture,
                roughness: 0.28,
                metalness: 0.25
            });
            btnFwd15Mesh = new THREE.Mesh(
                new THREE.BoxGeometry(b2W, b2H, bDepth),
                [steelSideMat, steelSideMat, steelSideMat, steelSideMat, btnFwdFrontMat, steelSideMat]
            );
            btnFwd15Mesh.position.set(0.36, row2Y, btnZ);
            btnFwd15Mesh.userData = {
                action: 'fwd15',
                initialZ: btnZ,
                promptText: '[LMB] +15s'
            };
            panelGroup.add(btnFwd15Mesh);
            cinemaControlMeshes.push(btnFwd15Mesh);

            // ── ZEILE 3: [Scrubber zum Spulen mit Zeitanzeige] ──
            timeDisplayCanvas = document.createElement("canvas");
            timeDisplayCanvas.width = 1024;
            timeDisplayCanvas.height = 128;
            timeDisplayCtx = timeDisplayCanvas.getContext("2d");
            timeDisplayTexture = new THREE.CanvasTexture(timeDisplayCanvas);
            timeDisplayTexture.colorSpace = THREE.SRGBColorSpace;

            renderTimeDisplayTexture(0, 0, false);

            timeDisplayMesh = new THREE.Mesh(
                new THREE.PlaneGeometry(1.04, 0.055),
                new THREE.MeshBasicMaterial({ map: timeDisplayTexture })
            );
            timeDisplayMesh.position.set(0, -0.13, chassisDepth / 2 + 0.002);
            panelGroup.add(timeDisplayMesh);

            // Scrubber Track im Edelstahlgehäuse
            const trackWidth = 1.04;
            const trackHeight = 0.055;
            const trackDepth = 0.014;
            const trackZ = chassisDepth / 2 + trackDepth / 2;
            const usableTrack = trackWidth - 0.04;

            const trackMat = new THREE.MeshStandardMaterial({
                color: 0xecf0f5,
                roughness: 0.30,
                metalness: 0.25
            });
            scrubberTrackMesh = new THREE.Mesh(
                new THREE.BoxGeometry(trackWidth, trackHeight, trackDepth),
                trackMat
            );
            scrubberTrackMesh.position.set(0, -0.21, trackZ);
            scrubberTrackMesh.userData = {
                action: 'scrubber',
                trackWidth: trackWidth,
                promptText: '[LMB] Spulen'
            };
            panelGroup.add(scrubberTrackMesh);
            cinemaControlMeshes.push(scrubberTrackMesh);

            // Inset Slot (Präzise gefräste Aussparung)
            const slotMat = new THREE.MeshBasicMaterial({ color: 0x09090b });
            const slotMesh = new THREE.Mesh(
                new THREE.BoxGeometry(usableTrack, 0.016, 0.005),
                slotMat
            );
            slotMesh.position.set(0, -0.21, trackZ + trackDepth / 2 + 0.001);
            panelGroup.add(slotMesh);

            // Scrubber Fill Bar (Rot)
            const fillMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
            const fillGeo = new THREE.BoxGeometry(usableTrack, 0.012, 0.006);
            fillGeo.translate(usableTrack / 2, 0, 0); // Pivot links
            scrubberFillMesh = new THREE.Mesh(fillGeo, fillMat);
            scrubberFillMesh.position.set(-usableTrack / 2, -0.21, trackZ + trackDepth / 2 + 0.003);
            scrubberFillMesh.scale.x = 0.001;
            panelGroup.add(scrubberFillMesh);

            // Scrubber Knob (Massiver gedrehter Edelstahlzylinder)
            const knobMat = new THREE.MeshStandardMaterial({
                color: 0xf8fafc,
                metalness: 0.35,
                roughness: 0.22
            });
            scrubberKnobMesh = new THREE.Mesh(
                new THREE.CylinderGeometry(0.018, 0.018, 0.058, 24),
                knobMat
            );
            scrubberKnobMesh.position.set(-usableTrack / 2, -0.21, trackZ + trackDepth / 2 + 0.012);
            panelGroup.add(scrubberKnobMesh);

            scene.add(panelGroup);
        }

        function setCinemaVideo(videoId, playing, seekSec) {
            currentCinemaVideoId = videoId;
            currentCinemaPlaying = Boolean(playing);

            if (!cssScene) return;
            if (!cinemaIframe || !document.getElementById('cinema-iframe-id')) {
                initCSS3DCinema();
            }

            const wrapper = document.getElementById('cinema-inworld-wrapper');

            if (!videoId) {
                loadedCinemaVideoId = null;
                if (ytPlayer && typeof ytPlayer.stopVideo === 'function') {
                    try { ytPlayer.stopVideo(); } catch(e) {}
                }
                if (wrapper) wrapper.style.opacity = '0';
                if (projectorBeamMesh) projectorBeamMesh.visible = false;
                if (projectorFlareMesh) projectorFlareMesh.visible = false;
                updateControlPanelDisplay();
                return;
            }

            if (wrapper) wrapper.style.opacity = '1';
            if (projectorBeamMesh) projectorBeamMesh.visible = true;
            if (projectorFlareMesh) projectorFlareMesh.visible = true;

            ensureYouTubeAPI(() => {
                const startSec = Math.floor(seekSec || 0);

                if (!ytPlayer) {
                    loadedCinemaVideoId = videoId;
                    ytPlayer = new YT.Player('cinema-iframe-id', {
                        width: '1280',
                        height: '720',
                        videoId: videoId,
                        playerVars: {
                            autoplay: playing ? 1 : 0,
                            controls: 0,
                            disablekb: 1,
                            enablejsapi: 1,
                            fs: 0,
                            iv_load_policy: 3,
                            modestbranding: 1,
                            playsinline: 1,
                            rel: 0,
                            start: startSec,
                            origin: window.location.origin
                        },
                        events: {
                            'onReady': (event) => {
                                ytPlayerReady = true;
                                loadedCinemaVideoId = videoId;
                                const iframe = event.target.getIframe();
                                if (iframe) {
                                    iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
                                    iframe.style.width = '100%';
                                    iframe.style.height = '100%';
                                    iframe.style.border = '0';
                                }
                                ytPlayerDuration = ytPlayer.getDuration() || 0;
                                if (playing) {
                                    try {
                                        if (ytPlayer.isMuted && ytPlayer.isMuted()) ytPlayer.unMute();
                                        event.target.playVideo();
                                    } catch(e) {
                                        console.warn("Autoplay error:", e);
                                    }
                                }
                                updateControlPanelDisplay();
                            },
                            'onStateChange': (event) => {
                                if (event.data === YT.PlayerState.PLAYING) {
                                    currentCinemaPlaying = true;
                                    ytPlayerDuration = ytPlayer.getDuration() || 0;
                                } else if (event.data === YT.PlayerState.PAUSED) {
                                    currentCinemaPlaying = false;
                                } else if (event.data === YT.PlayerState.ENDED) {
                                    currentCinemaPlaying = false;
                                }
                                updateControlPanelDisplay();
                            }
                        }
                    });
                } else if (ytPlayerReady) {
                    try {
                        if (loadedCinemaVideoId !== videoId) {
                            loadedCinemaVideoId = videoId;
                            ytPlayer.loadVideoById({ videoId: videoId, startSeconds: startSec });
                            if (!playing) ytPlayer.pauseVideo();
                        } else {
                            const curTime = ytPlayer.getCurrentTime ? ytPlayer.getCurrentTime() : 0;
                            if (Math.abs(curTime - startSec) > 2.0) {
                                ytPlayer.seekTo(startSec, true);
                            }
                            if (playing) {
                                if (ytPlayer.isMuted && ytPlayer.isMuted()) ytPlayer.unMute();
                                ytPlayer.playVideo();
                            } else {
                                ytPlayer.pauseVideo();
                            }
                        }
                    } catch(e) {
                        console.warn("ytPlayer control error:", e);
                    }
                    updateControlPanelDisplay();
                }
            });
        }

        function initCSS3DCinema() {
            if (!cssScene) return;
            if (cinemaIframe && document.getElementById('cinema-iframe-id')) return;

            const wrapper = document.createElement('div');
            wrapper.id = 'cinema-inworld-wrapper';
            wrapper.style.position = 'relative';
            wrapper.style.width = '1280px';
            wrapper.style.height = '720px';
            wrapper.style.background = '#000000';
            wrapper.style.overflow = 'hidden';
            wrapper.style.userSelect = 'none';
            wrapper.style.opacity = '0';
            wrapper.style.transition = 'opacity 0.25s ease';

            // YouTube IFrame Target Container (Clean, keine störenden Overlays)
            cinemaIframe = document.createElement('div');
            cinemaIframe.id = 'cinema-iframe-id';
            cinemaIframe.style.position = 'absolute';
            cinemaIframe.style.top = '0';
            cinemaIframe.style.left = '0';
            cinemaIframe.style.width = '100%';
            cinemaIframe.style.height = '100%';
            cinemaIframe.style.border = '0';
            wrapper.appendChild(cinemaIframe);

            cssCinemaObject = new CSS3DObject(wrapper);
            // 3D-Skalierung: 1280x720 px -> 4.71m x 2.65m (sitzt exakt bündig innerhalb der Leinwand)
            cssCinemaObject.scale.set(0.00368, 0.00368, 0.00368);
            
            if (cinemaScreenMesh) {
                cssCinemaObject.position.copy(cinemaScreenMesh.position);
                cssCinemaObject.rotation.y = cinemaScreenMesh.rotation.y;
                // 1.5 cm vor der Trägerleinwand platzieren
                cssCinemaObject.translateZ(0.015);
            } else {
                cssCinemaObject.position.set(5.86, 2.35, 16.14);
                cssCinemaObject.rotation.y = 0.9425;
            }
            cssCinemaObject.visible = true;
            cssScene.add(cssCinemaObject);

            if (cssRenderer && cssRenderer.domElement && wrapper.parentNode !== cssRenderer.domElement) {
                cssRenderer.domElement.appendChild(wrapper);
            }
        }

        function syncCinemaState(state, fromNetwork) {
            if (fromNetwork) {
                // Wenn wir vor kurzem lokal interagiert haben oder RTDB Schreibrechte fehlen, Rollback ignorieren
                if (!cinemaRtdbWritable || (Date.now() - lastLocalCinemaTimestamp < 3500)) {
                    return;
                }
                if (state && state.updatedAt && state.updatedAt < lastLocalCinemaTimestamp) {
                    return;
                }
            }

            if (!state || !state.videoId) {
                currentCinemaVideoId = null;
                currentCinemaPlaying = false;
                currentCinemaStartedAt = 0;
                currentCinemaSeekSec = 0;
                setCinemaVideo(null, false, 0);
                const el = document.getElementById('cinema-status');
                if (el) el.textContent = 'Kein Video aktiv.';
                return;
            }

            const vid = state.videoId;
            const playing = state.isPlaying !== false;
            currentCinemaPlaying = playing;
            currentCinemaStartedAt = state.startedAt || 0;
            currentCinemaSeekSec = state.seekSec || 0;

            let targetTime = currentCinemaSeekSec;
            if (playing && currentCinemaStartedAt > 0) {
                targetTime += Math.max(0, (Date.now() - currentCinemaStartedAt) / 1000);
            }

            setCinemaVideo(vid, playing, targetTime);

            const el = document.getElementById('cinema-status');
            if (el) el.textContent = playing ? 'Wiedergabe aktiv (Synchron für alle)' : 'Pausiert';
        }

        function pushCinemaState(videoId, isPlaying, seekSec) {
            const now = Date.now();
            lastLocalCinemaTimestamp = now;
            const state = {
                videoId: videoId || null,
                isPlaying: Boolean(isPlaying),
                seekSec: Number(seekSec || 0),
                startedAt: isPlaying ? now : 0,
                updatedBy: currentUser ? currentUser.uid : 'guest',
                updatedAt: now
            };

            // Sofort lokal anwenden, damit das Video ohne Verzoegerung reagiert
            syncCinemaState(state, false);

            if (rtdb && currentUser && !currentUser.isMock && currentUser.uid !== 'guest' && currentUser.uid !== 'guest-dev') {
                rtdbSet(rtdbRef(rtdb, 'worldState/cinema'), state).then(() => {
                    cinemaRtdbWritable = true;
                    const el = document.getElementById('cinema-status');
                    if (el && isPlaying && videoId) {
                        el.textContent = 'Wiedergabe aktiv (Synchron für alle)';
                    }
                }).catch(err => {
                    console.warn('RTDB cinema update error:', err);
                    if (err.code === 'PERMISSION_DENIED' || (err.message && err.message.includes('PERMISSION_DENIED'))) {
                        cinemaRtdbWritable = false;
                    }
                    const el = document.getElementById('cinema-status');
                    if (el) {
                        if (err.code === 'PERMISSION_DENIED' || (err.message && err.message.includes('PERMISSION_DENIED'))) {
                            el.textContent = 'Video läuft lokal. In Firebase fehlt Schreibregel für "worldState"!';
                        } else {
                            el.textContent = 'Video läuft lokal (Sync: ' + (err.code || 'Offline') + ')';
                        }
                    }
                });
            }
        }

        function openCinemaModal() {
            isModalOpen = true;
            isCinemaModalOpen = true;
            document.getElementById('cinema-modal').classList.add('visible');
            if (cssRenderer && cssRenderer.domElement) {
                cssRenderer.domElement.style.pointerEvents = 'auto';
            }
            if (controls && controls.isLocked) controls.unlock();
        }

        function closeCinemaModal() {
            isModalOpen = false;
            isCinemaModalOpen = false;
            document.getElementById('cinema-modal').classList.remove('visible');
            if (cssRenderer && cssRenderer.domElement) {
                cssRenderer.domElement.style.pointerEvents = 'none';
            }
        }
        let targetNightTransition = 0.0;
        let nightTransition = 0.0;
        let chillenLampInteractMesh = null;
        let chillenLampLight = null;
        let chillenLampShadeMat = null;
        let sceneAmbientLight = null;
        let sceneDirLight = null;

        function toggleChillenLamp() {
            const newState = !isChillenLampOn;
            setChillenLampState(newState, true);
        }

        function setChillenLampState(on, syncToNetwork) {
            isChillenLampOn = on;
            targetNightTransition = on ? 1.0 : 0.0;

            if (chillenLampLight) {
                chillenLampLight.visible = on;
            }
            if (chillenLampShadeMat) {
                chillenLampShadeMat.emissive.setHex(on ? 0xfef08a : 0x000000);
                chillenLampShadeMat.emissiveIntensity = on ? 1.5 : 0.0;
            }

            if (syncToNetwork && rtdb) {
                rtdbSet(rtdbRef(rtdb, "worldState/chillenLamp"), {
                    isOn: on,
                    updatedBy: currentUser ? currentUser.uid : "guest",
                    updatedAt: Date.now()
                }).catch(err => console.warn("RTDB lamp update error:", err));
            }
        }

        let isJetpackEquipped = false;
        let isJetpackThrusting = false;
        let spacePressed = false;
        let worldJetpackGroup = null;
        let jetpackInteractMesh = null;
        let warehouseJetpacks = []; // [{ id, group, hitBox, defaultPos, isEquipped }]
        let currentEquippedJetpack = null;
        let localJetpackCockpit = null;
        let localJetpackFlames = null;
        let localJetpackLight = null;

        function mountBike() {
            if (isSitting) standUp();
            isRidingBike = true;
            if (worldBikeGroup) worldBikeGroup.visible = false;
            if (localBikeCockpit) localBikeCockpit.visible = true;
            interactPrompt.textContent = "[E] oder [ESC] Absteigen";
            interactPrompt.classList.add("visible");
        }

        function dismountBike() {
            if (!isRidingBike) return;
            isRidingBike = false;
            if (localBikeCockpit) localBikeCockpit.visible = false;
            if (worldBikeGroup && camera) {
                // Fahrrad auf Boden am aktuellen Spielerstandort abstellen
                worldBikeGroup.position.set(camera.position.x, 0, camera.position.z);
                const camDir = new THREE.Vector3();
                camera.getWorldDirection(camDir);
                worldBikeGroup.rotation.y = Math.atan2(camDir.x, camDir.z);
                worldBikeGroup.visible = true;
            }
            interactPrompt.classList.remove("visible");
        }

        function equipJetpack(targetJpObj) {
            if (isSitting) standUp();
            let jpObj = targetJpObj;
            if (!jpObj) {
                jpObj = warehouseJetpacks.find(j => !j.isEquipped && j.group.visible) || warehouseJetpacks[0];
            }
            if (!jpObj) return;

            currentEquippedJetpack = jpObj;
            worldJetpackGroup = jpObj.group;
            isJetpackEquipped = true;
            jpObj.isEquipped = true;
            jpObj.group.visible = false;

            if (localJetpackCockpit) localJetpackCockpit.visible = !isThirdPersonMode;
            if (localPlayerJetpack) localPlayerJetpack.visible = true;

            interactPrompt.textContent = "[LEERTASTE] Schub nach oben\n[E] Jetpack ablegen";
            interactPrompt.classList.add("visible");

            try {
                const jpRef = rtdbRef(rtdb, "worldState/warehouseJetpacks/" + jpObj.id);
                rtdbSet(jpRef, {
                    isEquipped: true,
                    equippedBy: myUserId || 'local',
                    updatedAt: Date.now()
                });
            } catch (err) {
                console.warn("RTDB sync jetpack equip error:", err);
            }
        }

        function dropJetpack() {
            if (!isJetpackEquipped || !currentEquippedJetpack) return;
            const jpObj = currentEquippedJetpack;
            isJetpackEquipped = false;
            currentEquippedJetpack = null;

            if (isJetpackThrusting) {
                isJetpackThrusting = false;
                jetpackAudio.setThrust(false);
            }
            if (localPlayerJetpack) localPlayerJetpack.visible = false;
            if (localJetpackCockpit) {
                localJetpackCockpit.visible = false;
                if (localJetpackFlames) localJetpackFlames.visible = false;
                if (localJetpackLight) localJetpackLight.intensity = 0;
            }

            const camDir = new THREE.Vector3();
            camera.getWorldDirection(camDir);
            const dropRotY = Math.atan2(camDir.x, camDir.z);
            const dropX = Number(playerPos.x.toFixed(3));
            const dropZ = Number(playerPos.z.toFixed(3));

            jpObj.group.position.set(dropX, 0.0, dropZ);
            jpObj.group.rotation.y = dropRotY;
            jpObj.group.visible = true;
            jpObj.isEquipped = false;

            interactPrompt.classList.remove("visible");

            try {
                const jpRef = rtdbRef(rtdb, "worldState/warehouseJetpacks/" + jpObj.id);
                rtdbSet(jpRef, {
                    isEquipped: false,
                    equippedBy: null,
                    x: dropX,
                    z: dropZ,
                    rotY: Number(dropRotY.toFixed(3)),
                    updatedAt: Date.now()
                });
            } catch (err) {
                console.warn("RTDB sync jetpack drop error:", err);
            }
        }

        function syncWarehouseJetpacksFromNetwork(data) {
            if (!data || typeof data !== "object") return;
            warehouseJetpacks.forEach(jp => {
                if (isJetpackEquipped && currentEquippedJetpack && currentEquippedJetpack.id === jp.id) {
                    return;
                }
                const jpData = data[jp.id];
                if (!jpData) return;

                if (jpData.isEquipped) {
                    jp.isEquipped = true;
                    jp.group.visible = false;
                } else {
                    jp.isEquipped = false;
                    jp.group.visible = true;
                    if (typeof jpData.x === "number" && typeof jpData.z === "number") {
                        jp.group.position.set(jpData.x, 0.05, jpData.z);
                    }
                    if (typeof jpData.rotY === "number") {
                        jp.group.rotation.y = jpData.rotY;
                    }
                }
            });
        }

        // â”€â”€ BILD-KOMPRIMIERUNGS-PROGRAMM (Maximal 100 KB) â”€â”€
        async function compressImageToMax100KB(file) {
            const MAX_BYTES = 100 * 1024; // 100 KB
            
            const img = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const image = new Image();
                    image.onload = () => resolve(image);
                    image.onerror = () => reject(new Error("Bild konnte nicht geladen werden."));
                    image.src = e.target.result;
                };
                reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
                reader.readAsDataURL(file);
            });

            let width = img.width;
            let height = img.height;
            const MAX_INITIAL_DIM = 1200;
            if (width > MAX_INITIAL_DIM || height > MAX_INITIAL_DIM) {
                if (width > height) {
                    height = Math.round((height * MAX_INITIAL_DIM) / width);
                    width = MAX_INITIAL_DIM;
                } else {
                    width = Math.round((width * MAX_INITIAL_DIM) / height);
                    height = MAX_INITIAL_DIM;
                }
            }

            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, width, height);

            let quality = 0.85;
            let dataUrl = canvas.toDataURL("image/jpeg", quality);
            let byteSize = Math.round((dataUrl.length - dataUrl.indexOf(",") - 1) * 3 / 4);

            let iterations = 0;
            while (byteSize > MAX_BYTES && iterations < 18) {
                iterations++;
                if (quality > 0.35) {
                    quality -= 0.10;
                } else {
                    width = Math.round(width * 0.80);
                    height = Math.round(height * 0.80);
                    canvas.width = width;
                    canvas.height = height;
                    ctx.drawImage(img, 0, 0, width, height);
                    quality = 0.70;
                }
                dataUrl = canvas.toDataURL("image/jpeg", quality);
                byteSize = Math.round((dataUrl.length - dataUrl.indexOf(",") - 1) * 3 / 4);
            }

            return {
                dataUrl: dataUrl,
                byteSize: byteSize,
                width: width,
                height: height
            };
        }

        // â”€â”€ HILFSFUNKTIONEN â”€â”€
        function escapeHtml(str) {
            if (!str) return "";
            return String(str)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }

        function getStoredNickname() {
            const saved = localStorage.getItem("mansion_nickname");
            if (saved && saved.trim()) return saved.trim();
            if (currentUser && currentUser.displayName) return currentUser.displayName;
            if (currentUser && currentUser.email) return currentUser.email.split("@")[0];
            return "Gast";
        }

        function updateNavUserDisplay() {
            if (!currentUser) return;
            const nick = getStoredNickname();
            navUserEmail.textContent = `${nick} (${currentUser.email || "Angemeldet"})`;
        }

        function formatNoteDate(timestamp) {
            if (!timestamp) return "Heute";
            let date = null;
            if (typeof timestamp.toDate === "function") {
                date = timestamp.toDate();
            } else if (typeof timestamp.seconds === "number") {
                date = new Date(timestamp.seconds * 1000);
            } else if (typeof timestamp === "number" || typeof timestamp === "string") {
                date = new Date(timestamp);
            }
            if (!date || isNaN(date.getTime())) return "Heute";

            return date.toLocaleDateString("de-DE", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric"
            });
        }

        // â”€â”€ FEHLERBEHANDLUNG â”€â”€
        function showError(msg) {
            errorText.textContent = msg;
            errorBox.classList.add("visible");
        }

        function clearError() {
            errorText.textContent = "";
            errorBox.classList.remove("visible");
        }

        function getErrorMessage(code) {
            switch (code) {
                case "auth/invalid-email":
                    return "Bitte gib eine gÃ¼ltige E-Mail-Adresse ein.";
                case "auth/user-not-found":
                    return "Kein Benutzerkonto mit dieser E-Mail-Adresse gefunden.";
                case "auth/wrong-password":
                case "auth/invalid-credential":
                    return "E-Mail oder Passwort ist nicht korrekt.";
                case "auth/user-disabled":
                    return "Dieses Benutzerkonto wurde deaktiviert.";
                case "auth/too-many-requests":
                    return "Zu viele Versuche. Bitte warte kurz und versuche es erneut.";
                case "auth/network-request-failed":
                    return "Netzwerkfehler. Bitte Ã¼berprÃ¼fe deine Verbindung.";
                default:
                    return "Anmeldung fehlgeschlagen. Bitte prÃ¼fe deine Daten.";
            }
        }

        function setLoginSubmitting(isSubmitting) {
            btnLogin.disabled = isSubmitting;
            if (isSubmitting) {
                btnLoginText.textContent = "Anmelden...";
                btnLoginSpinner.classList.remove("hidden");
            } else {
                btnLoginText.textContent = "Anmelden";
                btnLoginSpinner.classList.add("hidden");
            }
        }

        // â”€â”€ AUTH LISTENER â”€â”€
        onAuthStateChanged(auth, (user) => {
            loadingState.classList.add("hidden");
            if (user) {
                currentUser = user;
                authContainer.classList.add("hidden");
                gameContainer.style.display = "block";
                updateNavUserDisplay();
                
                initThreeWorld();
                subscribeToNotes();
                startPlayerSync();
                subscribeToRemotePlayers();
            } else {
                currentUser = null;
                if (controls && controls.isLocked) controls.unlock();
                if (unsubscribeNotes) {
                    unsubscribeNotes();
                    unsubscribeNotes = null;
                }
                stopPlayerSync();
                clearAllNoteMeshes();
                gameContainer.style.display = "none";
                authContainer.classList.remove("hidden");
                loginView.classList.remove("hidden");
                clearError();
            }
        });

        window.__devInitWorld = () => {
            currentUser = { uid: "guest-dev", email: "dev@denmuen.ch" };
            authContainer.classList.add("hidden");
            gameContainer.style.display = "block";
            updateNavUserDisplay();
            initThreeWorld();
        };
        window.__teleport = (x, y, z, lookAtX, lookAtY, lookAtZ) => {
            if (camera) {
                camera.position.set(x, y, z);
                if (playerPos) {
                    playerPos.x = x;
                    playerPos.y = y;
                    playerPos.z = z;
                }
                if (typeof lookAtX === 'number') {
                    camera.lookAt(lookAtX, lookAtY, lookAtZ);
                }
            }
        };
        window.__cinemaControl = {
            setCinemaVideo,
            pushCinemaState,
            handleCinemaControlClick,
            handleCinemaScreenClick,
            getControlMeshes: () => cinemaControlMeshes,
            isReady: () => Boolean(scene && cinemaControlMeshes.length > 0),
            getYtPlayer: () => ytPlayer,
            getYtApiReady: () => ytApiReady
        };

        if (window.location.search.includes('dev=1')) {
            setTimeout(() => {
                if (!currentUser) window.__devInitWorld();
            }, 300);
        }

        // Tab schlieÃŸen
        window.addEventListener("beforeunload", () => {
            if (myPlayerRef) {
                rtdbRemove(myPlayerRef).catch(() => {});
            }
        });

        // Login Form
        loginForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            clearError();

            const email = emailInput.value.trim();
            const password = passwordInput.value;

            if (!email || !password) {
                showError("Bitte fÃ¼lle E-Mail und Passwort aus.");
                return;
            }

            setLoginSubmitting(true);
            try {
                await signInWithEmailAndPassword(auth, email, password);
                loginForm.reset();
            } catch (err) {
                showError(getErrorMessage(err.code));
            } finally {
                setLoginSubmitting(false);
            }
        });

        // Logout
        btnLogout.addEventListener("click", async () => {
            try {
                await signOut(auth);
            } catch (err) {
                alert("Fehler beim Abmelden.");
            }
        });

        // â”€â”€ EINSTELLUNGEN MODAL â”€â”€
        // ── KINO QUICK-MODAL (YOUTUBE URL EINGABE) ──
        const cinemaQuickModal = document.getElementById("cinema-quick-modal");
        const cinemaQuickInput = document.getElementById("cinema-quick-input");
        const btnCinemaQuickCancel = document.getElementById("btn-cinema-quick-cancel");
        const btnCinemaQuickSubmit = document.getElementById("btn-cinema-quick-submit");

        function openCinemaQuickModal() {
            if (!cinemaQuickModal) return;
            if (controls && controls.isLocked) controls.unlock();
            isModalOpen = true;
            cinemaQuickModal.classList.add("visible");
            if (cinemaQuickInput) {
                cinemaQuickInput.value = '';
                setTimeout(() => cinemaQuickInput.focus(), 60);
            }
        }

        function closeCinemaQuickModal() {
            if (!cinemaQuickModal) return;
            cinemaQuickModal.classList.remove("visible");
            isModalOpen = false;
            if (controls && !controls.isLocked) {
                setTimeout(() => controls.lock(), 60);
            }
        }

        if (btnCinemaQuickCancel) {
            btnCinemaQuickCancel.addEventListener("click", closeCinemaQuickModal);
        }

        if (btnCinemaQuickSubmit) {
            btnCinemaQuickSubmit.addEventListener("click", () => {
                const raw = (cinemaQuickInput ? cinemaQuickInput.value : '').trim();
                const vid = parseYouTubeId(raw);
                if (vid) {
                    pushCinemaState(vid, true, 0);
                    closeCinemaQuickModal();
                } else {
                    alert("Ungültige YouTube-URL oder Video-ID.");
                }
            });
        }

        if (cinemaQuickInput) {
            cinemaQuickInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    btnCinemaQuickSubmit.click();
                }
            });
        }

        if (cinemaQuickModal) {
            cinemaQuickModal.addEventListener("click", (e) => {
                if (e.target === cinemaQuickModal) closeCinemaQuickModal();
            });
        }

        function handleCinemaInteraction(uv) {
            handleCinemaScreenClick();
        }

        btnSettings.addEventListener("click", () => {
            if (controls && controls.isLocked) controls.unlock();
            settingsNickname.value = getStoredNickname();
            tempThirdPersonChoice = isThirdPersonMode;
            updateCamButtonsUI(tempThirdPersonChoice);
            isModalOpen = true;
            settingsModal.classList.add("visible");
            setTimeout(() => settingsNickname.focus(), 60);
        });

        if (btnCamFirst) {
            btnCamFirst.addEventListener("click", () => {
                tempThirdPersonChoice = false;
                updateCamButtonsUI(false);
            });
        }

        if (btnCamThird) {
            btnCamThird.addEventListener("click", () => {
                tempThirdPersonChoice = true;
                updateCamButtonsUI(true);
            });
        }

        function closeSettingsModal() {
            isModalOpen = false;
            settingsModal.classList.remove("visible");
        }

        btnCancelSettings.addEventListener("click", () => {
            closeSettingsModal();
            try {
                if (controls && !controls.isLocked) controls.lock();
            } catch (err) {}
        });

        btnSaveSettings.addEventListener("click", () => {
            const val = settingsNickname.value.trim();
            if (!val) {
                alert("Bitte gib einen Namen ein (1-20 Zeichen).");
                return;
            }
            const cleanNick = val.slice(0, 20);
            localStorage.setItem("mansion_nickname", cleanNick);
            updateNavUserDisplay();

            setCameraMode(tempThirdPersonChoice);
            const myColor = currentUser ? getPlayerColor(currentUser.uid) : "#3b82f6";
            createLocalPlayerModel(myColor, cleanNick);

            if (myPlayerRef) {
                rtdbUpdate(myPlayerRef, { nickname: cleanNick }).catch(err => console.error("RTDB Nick-Update Fehler:", err));
            }

            closeSettingsModal();
            try {
                if (controls && !controls.isLocked) controls.lock();
            } catch (err) {}
        });

        settingsNickname.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                btnSaveSettings.click();
            }
        });

        // â”€â”€ NOTIZ DETAIL & LÃ–SCHEN MODAL â”€â”€
        function openViewNoteModal(noteId, data) {
            if (!data) return;
            isModalOpen = true;
            moveState.forward = moveState.backward = moveState.left = moveState.right = false;
            if (controls && controls.isLocked) controls.unlock();

            const author = data.author || "Anonym";
            const dateStr = formatNoteDate(data.createdAt);
            
            const isImage = data.type === "image" && data.imageUrl;
            const titleEl = document.getElementById("view-note-title");
            if (titleEl) {
                titleEl.textContent = isImage ? (data.caption || "Kunstwerk") : "Notiz an der Pinwand";
            }

            viewNoteMeta.innerHTML = "";

            if (isImage) {
                viewNoteImageContainer.style.display = "block";
                viewNoteImage.src = data.imageUrl;
                viewNoteBody.style.display = data.caption ? "block" : "none";
                viewNoteBody.textContent = data.caption || "";
            } else {
                viewNoteImageContainer.style.display = "none";
                viewNoteBody.style.display = "block";
                viewNoteBody.textContent = data.text || "";
            }
            
            btnDeleteNote.dataset.noteId = noteId;
            btnDeleteNote.disabled = false;
            btnDeleteNote.innerHTML = isImage ? "<span>Bild entfernen</span>" : "<span>Notiz entfernen</span>";

            viewNoteModal.classList.add("visible");
            interactPrompt.classList.remove("visible");
        }

        function closeViewNoteModal() {
            isModalOpen = false;
            viewNoteModal.classList.remove("visible");
            btnDeleteNote.dataset.noteId = "";
        }

        btnCloseViewNote.addEventListener("click", () => {
            closeViewNoteModal();
            try {
                if (controls && !controls.isLocked) controls.lock();
            } catch (err) {}
        });

        btnDeleteNote.addEventListener("click", async () => {
            const noteId = btnDeleteNote.dataset.noteId;
            if (!noteId) return;

            if (!confirm("MÃ¶chtest du diese Notiz wirklich von der Wand entfernen?")) {
                return;
            }

            btnDeleteNote.disabled = true;
            btnDeleteNote.innerHTML = "<span>Wird gelÃ¶scht...</span>";

            try {
                await deleteDoc(firestoreDoc(db, "notes", noteId));
                closeViewNoteModal();
                try {
                    if (controls && !controls.isLocked) controls.lock();
                } catch (err) {}
            } catch (err) {
                console.error("Fehler beim LÃ¶schen:", err);
                alert("Fehler beim LÃ¶schen: " + (err.message || "Unbekannter Fehler"));
                btnDeleteNote.disabled = false;
                btnDeleteNote.innerHTML = "<span>Entfernen</span>";
            }
        });

        // â”€â”€ SITZ-SYSTEM â”€â”€
        function registerSeat(mesh, name, sitPos, lookDir) {
            const seatObj = { mesh, name, sitPos, lookDir };
            mesh.userData.isSeat = true;
            mesh.userData.seat = seatObj;
            seats.push(seatObj);
            seatMeshes.push(mesh);
        }

        function sitDown(seat) {
            if (!seat) return;
            isSitting = true;
            currentSeat = seat;
            velocityY = 0;
            isOnGround = true;

            playerPos.copy(seat.sitPos);
            camera.position.copy(seat.sitPos);
            interactPrompt.textContent = "Taste [E], [LEERTASTE] oder [W,A,S,D]: Aufstehen";
            interactPrompt.classList.add("visible");
        }

        function standUp() {
            if (!isSitting) return;
            isSitting = false;
            velocityY = 0;
            isOnGround = true;

            if (currentSeat && currentSeat.lookDir) {
                playerPos.add(currentSeat.lookDir.clone().multiplyScalar(0.7));
            }
            playerPos.y = EYE_HEIGHT;
            camera.position.copy(playerPos);
            currentSeat = null;
            interactPrompt.classList.remove("visible");
        }

        // â”€â”€ 3D THREE.JS UMGEBUNG â”€â”€
        let scene, camera, renderer, controls;
        let wallMeshes = [];
        let raycaster;
        const centerCoords = new THREE.Vector2(0, 0);
        let animationFrameId = null;
        let artSculpture = null;

        const moveState = { forward: false, backward: false, left: false, right: false };
        const moveSpeed = 6.5;
        const clock = new THREE.Clock();

        const COURTYARD_RADIUS = 24.0;
        const WALL_HEIGHT = 5.0;
        const EYE_HEIGHT = 1.70;
        const playerPos = new THREE.Vector3(0, EYE_HEIGHT, 0);

        // 5 Satellitenraeume in exakter 5-Eck-Symmetrie (Pentagon, alle 72 Grad um den Innenhof):
        // 0: Nord (-90 deg): Arbeit
        // 1: Ost-Nord-Ost (-18 deg): Kunst
        // 2: Sued-Ost (+54 deg): Chillen
        // 3: Sued-West (+126 deg): Gaming
        // 4: West-Nord-West (+198 deg / -162 deg): Lager
        const SATELLITE_ROOMS = [
            { name: "Arbeit", cx: 0.0, cz: -16.5, radius: 5.5, rotY: 0.0, doorAngle: Math.PI / 2, pinAngle: Math.PI },
            { name: "Kunst", cx: 15.692, cz: -5.099, radius: 5.5, rotY: -1.2566, doorAngle: 2.8274, pinAngle: -0.3142 },
            { name: "Chillen", cx: 9.698, cz: 13.349, radius: 5.5, rotY: -2.5133, doorAngle: -2.1991, pinAngle: -0.6283 },
            { name: "Gaming", cx: -9.698, cz: 13.349, radius: 5.5, rotY: 2.5133, doorAngle: -0.9425, pinAngle: 0.6283 },
            { name: "Lager", cx: -15.692, cz: -5.099, radius: 5.5, rotY: 1.2566, doorAngle: 0.3142, pinAngle: 1.8850 }
        ];

        // â”€â”€ KRONENDÃ„CHER & TÃœRSCHILDER â”€â”€
        function createDoorSign(title, x, y, z, rotY) {
            const canvas = document.createElement("canvas");
            canvas.width = 2048;
            canvas.height = 768;
            const ctx = canvas.getContext("2d");

            ctx.clearRect(0, 0, 2048, 768);

            // Doppelt so groÃŸe weiÃŸe Schrift (360px statt 180px) in Corporate Font Quicksand
            ctx.fillStyle = "#ffffff";
            ctx.font = 'bold 360px "Quicksand", sans-serif';
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.shadowColor = "rgba(0, 0, 0, 0.95)";
            ctx.shadowBlur = 28;
            ctx.fillText(title, 1024, 384);

            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.needsUpdate = true;
            const mat = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                side: THREE.DoubleSide,
                toneMapped: false
            });
            // Doppelt so groÃŸe 3D-Geometrie (6.0m x 2.0m statt 3.2m x 1.05m)
            const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6.0, 2.0), mat);
            mesh.position.set(x, y + 0.20, z);
            mesh.rotation.y = rotY;
            scene.add(mesh);
        }

        // â”€â”€ SPAWN-BODENFLÃ„CHE MIT SCHRIFTZUG & MITTLEREM WEISSEN RING â”€â”€
        function createCurvedSpawnMesh() {
            const canvas = document.createElement("canvas");
            canvas.width = 2048;
            canvas.height = 2048;
            const ctx = canvas.getContext("2d");

            const cx = 1024;
            const cy = 1024;

            // 100% transparenter Hintergrund (filziger Teppichboden bleibt darunter vollstÃ¤ndig sichtbar)
            ctx.clearRect(0, 0, 2048, 2048);

            // Mittlerer weiÃŸer Ring
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 10;
            ctx.beginPath();
            ctx.arc(cx, cy, 880, 0, Math.PI * 2);
            ctx.stroke();

            // 1. MANSION: GroÃŸ und im oberen Halbkreis gerundet, mit gleichmÃ¤ÃŸigem Kerning
            ctx.font = 'bold 150px "Quicksand", sans-serif';
            ctx.fillStyle = "#ffffff";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            const mansion = "MANSION";
            const mansionRadius = 580;
            const letterSpacing = 28;
            let totalMansionWidth = 0;
            const mansionWidths = [];
            for (let i = 0; i < mansion.length; i++) {
                const w = ctx.measureText(mansion[i]).width + letterSpacing;
                mansionWidths.push(w);
                totalMansionWidth += w;
            }

            const totalMansionAngle = totalMansionWidth / mansionRadius;
            let currentMansionAngle = -Math.PI / 2 - totalMansionAngle / 2;

            for (let i = 0; i < mansion.length; i++) {
                const char = mansion[i];
                const charW = mansionWidths[i];
                const charAngle = charW / mansionRadius;
                const midAngle = currentMansionAngle + charAngle / 2;

                ctx.save();
                ctx.translate(cx + Math.cos(midAngle) * mansionRadius, cy + Math.sin(midAngle) * mansionRadius);
                ctx.rotate(midAngle + Math.PI / 2);
                ctx.fillText(char, 0, 0);
                ctx.restore();

                currentMansionAngle += charAngle;
            }

            // 2. Akronym im unteren Halbkreis (tangential und aufrecht lesbar gerundet)
            ctx.font = 'bold 36px "Quicksand", sans-serif';
            ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            const acronym = "MULTI ANGLE NAVIGATION SYSTEM FOR IDEA ORGANIZING AND NOTEBOOKING";
            const acronymRadius = 750;
            const acronymSpacing = 6;
            let totalAcronymWidth = 0;
            const acronymWidths = [];
            for (let i = 0; i < acronym.length; i++) {
                const w = ctx.measureText(acronym[i]).width + acronymSpacing;
                acronymWidths.push(w);
                totalAcronymWidth += w;
            }

            const totalAcronymAngle = totalAcronymWidth / acronymRadius;
            let currentAcronymAngle = Math.PI / 2 + totalAcronymAngle / 2;

            for (let i = 0; i < acronym.length; i++) {
                const char = acronym[i];
                const charW = acronymWidths[i];
                const charAngle = charW / acronymRadius;
                const midAngle = currentAcronymAngle - charAngle / 2;

                ctx.save();
                ctx.translate(cx + Math.cos(midAngle) * acronymRadius, cy + Math.sin(midAngle) * acronymRadius);
                ctx.rotate(midAngle - Math.PI / 2);
                ctx.fillText(char, 0, 0);
                ctx.restore();

                currentAcronymAngle -= charAngle;
            }

            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.needsUpdate = true;

            const spawnMesh = new THREE.Mesh(
                new THREE.CircleGeometry(2.4, 64),
                new THREE.MeshBasicMaterial({
                    map: texture,
                    transparent: true,
                    side: THREE.DoubleSide,
                    toneMapped: false,
                    depthWrite: false
                })
            );
            spawnMesh.rotation.x = -Math.PI / 2;
            spawnMesh.position.set(0, 0.005, 0);
            return spawnMesh;
        }

        // â”€â”€ GEKRÃœMMTE NOTIZBEREICHE (PINWÃ„NDE MIT SCHWARZEM RAHMEN) â”€â”€
        function createCurvedPinboard(room) {
            const boardRadius = 5.46; // Minimal vor der Wand (r = 5.5)
            const boardHeight = 2.2;
            const boardArc = 1.05; // 50% breiterer Bogen an der Wand

            const canvas = document.createElement("canvas");
            canvas.width = 1536;
            canvas.height = 768;
            const ctx = canvas.getContext("2d");

            // Innenflaeche im aktuellen Hellgrau der Waende (#dcdce0)
            ctx.fillStyle = "#dcdce0";
            ctx.fillRect(0, 0, 1536, 768);

            // Robuster schwarzer Rahmen
            ctx.lineWidth = 28;
            ctx.strokeStyle = "#000000";
            ctx.strokeRect(14, 14, 1536 - 28, 768 - 28);

            // Header-Label: Immer "NOTIZEN" (ohne Unterstrich, horizontal gespiegelt fÃ¼r ungespiegelte Innenansicht)
            ctx.save();
            ctx.translate(1536 / 2, 85);
            ctx.scale(-1, 1);
            ctx.fillStyle = "#000000";
            ctx.font = 'bold 46px "Quicksand", sans-serif';
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("NOTIZEN", 0, 0);
            ctx.restore();

            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.needsUpdate = true;

            // Zylindersegment mit deckender Textur im Wandgrau
            const pinGeo = new THREE.CylinderGeometry(boardRadius, boardRadius, boardHeight, 32, 1, true, -boardArc / 2, boardArc);
            const pinMat = new THREE.MeshBasicMaterial({
                map: texture,
                side: THREE.DoubleSide,
                toneMapped: false
            });
            const pinMesh = new THREE.Mesh(pinGeo, pinMat);

            const rotY = -room.pinAngle + Math.PI / 2;
            // Perfekte MontagehÃ¶he: y = 2.0 (Unterkante 0.9m, Oberkante 3.1m, AugenhÃ¶he 1.70m mittig)
            pinMesh.position.set(room.cx, 2.0, room.cz);
            pinMesh.rotation.y = rotY;

            pinMesh.userData = {
                isPinboard: true,
                roomName: room.name,
                roomCenter: new THREE.Vector2(room.cx, room.cz),
                radius: boardRadius,
                boardHeight: boardHeight,
                boardArc: boardArc,
                pinAngle: room.pinAngle
            };

            scene.add(pinMesh);
            pinboardMeshes.push(pinMesh);
        }

        // â”€â”€ LEICHT KOERNIGE WANDTEXTUR FUER CHILLEN-RAUM (FEINPUTZ) â”€â”€
        function createGrainyWallTexture() {
            const canvas = document.createElement("canvas");
            canvas.width = 512;
            canvas.height = 512;
            const ctx = canvas.getContext("2d");

            // Wandgrundierung: Heller eleganter Wandton (#ececee)
            ctx.fillStyle = "#ececee";
            ctx.fillRect(0, 0, 512, 512);

            // Feines mineralisches Korn / Putzstruktur
            const imgData = ctx.getImageData(0, 0, 512, 512);
            const data = imgData.data;
            for (let i = 0; i < data.length; i += 4) {
                const grain = (Math.random() - 0.5) * 24;
                data[i]     = Math.min(255, Math.max(0, data[i] + grain));
                data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + grain));
                data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + grain));
            }
            ctx.putImageData(imgData, 0, 0);

            const texture = new THREE.CanvasTexture(canvas);
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(16, 4);
            return texture;
        }

        // â”€â”€ ZIEGELSTEIN-TEXTUR FUER DIE LAGER-INNENWAND (EINFACH GEHALTEN) â”€â”€
        function createWarehouseBrickTexture() {
            const canvas = document.createElement("canvas");
            canvas.width = 512;
            canvas.height = 256;
            const ctx = canvas.getContext("2d");

            // Moertel / Fugen: mineralisches Zementgrau
            ctx.fillStyle = "#9ca3af";
            ctx.fillRect(0, 0, 512, 256);

            const rows = 8;
            const rowH = 256 / rows;
            const brickW = 64;
            const mortar = 4;

            // Harmonische Farbpalette roter Lagerhausziegel
            const brickColors = [
                "#9a3c2b", "#a44331", "#8e3423", "#ad4c38", "#963827", "#883121"
            ];

            for (let r = 0; r < rows; r++) {
                const y = r * rowH + mortar / 2;
                const h = rowH - mortar;
                const offsetX = (r % 2 === 1) ? -brickW / 2 : 0;
                for (let x = offsetX - brickW; x < 512 + brickW; x += brickW) {
                    const colorIndex = Math.floor(Math.random() * brickColors.length);
                    ctx.fillStyle = brickColors[colorIndex];
                    ctx.fillRect(x + mortar / 2, y, brickW - mortar, h);
                }
            }

            const texture = new THREE.CanvasTexture(canvas);
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(18, 4);
            return texture;
        }

        // ── PBR PLASTER (PUTZ) TEXTUREN & MATERIALIEN ──
        const pbrTextureLoader = new THREE.TextureLoader();

        const plasterBaseColor = pbrTextureLoader.load('assets/textures/pbr/plaster_color.webp');
        plasterBaseColor.wrapS = THREE.RepeatWrapping;
        plasterBaseColor.wrapT = THREE.RepeatWrapping;
        plasterBaseColor.colorSpace = THREE.SRGBColorSpace;
        plasterBaseColor.anisotropy = 4;

        const plasterBaseNormal = pbrTextureLoader.load('assets/textures/pbr/plaster_normal.webp');
        plasterBaseNormal.wrapS = THREE.RepeatWrapping;
        plasterBaseNormal.wrapT = THREE.RepeatWrapping;
        plasterBaseNormal.colorSpace = THREE.NoColorSpace;
        plasterBaseNormal.anisotropy = 4;

        const plasterBaseRoughness = pbrTextureLoader.load('assets/textures/pbr/plaster_roughness.webp');
        plasterBaseRoughness.wrapS = THREE.RepeatWrapping;
        plasterBaseRoughness.wrapT = THREE.RepeatWrapping;
        plasterBaseRoughness.colorSpace = THREE.NoColorSpace;
        plasterBaseRoughness.anisotropy = 4;

        function createPlasterWallMaterial(repeatX, repeatY, side = THREE.FrontSide) {
            const colorTex = plasterBaseColor.clone();
            colorTex.wrapS = THREE.RepeatWrapping;
            colorTex.wrapT = THREE.RepeatWrapping;
            colorTex.repeat.set(repeatX, repeatY);
            colorTex.colorSpace = THREE.SRGBColorSpace;
            colorTex.anisotropy = 4;
            colorTex.needsUpdate = true;

            const normalTex = plasterBaseNormal.clone();
            normalTex.wrapS = THREE.RepeatWrapping;
            normalTex.wrapT = THREE.RepeatWrapping;
            normalTex.repeat.set(repeatX, repeatY);
            normalTex.colorSpace = THREE.NoColorSpace;
            normalTex.anisotropy = 4;
            normalTex.needsUpdate = true;

            const roughnessTex = plasterBaseRoughness.clone();
            roughnessTex.wrapS = THREE.RepeatWrapping;
            roughnessTex.wrapT = THREE.RepeatWrapping;
            roughnessTex.repeat.set(repeatX, repeatY);
            roughnessTex.colorSpace = THREE.NoColorSpace;
            roughnessTex.anisotropy = 4;
            roughnessTex.needsUpdate = true;

            return new THREE.MeshStandardMaterial({
                color: 0xffffff,
                map: colorTex,
                normalMap: normalTex,
                normalScale: new THREE.Vector2(0.9, 0.9),
                roughnessMap: roughnessTex,
                roughness: 0.92,
                metalness: 0.0,
                side: side
            });
        }

        // Geteilte Material-Instanzen zur optimalen GPU-Performance und Shader-Kompilierung
        const plasterCourtyardWallMat = createPlasterWallMaterial(48, 1.65, THREE.BackSide);
        const plasterRoomOuterWallMat = createPlasterWallMaterial(10, 1.65, THREE.FrontSide);
        const plasterRoomInnerWallMat = createPlasterWallMaterial(10, 1.65, THREE.BackSide);

        // ── PBR TILES109 (TERRAZZO FLIESEN) TEXTUREN & MATERIALIEN ──
        const tiles109BaseColor = pbrTextureLoader.load('assets/textures/pbr/tiles109_color.webp');
        tiles109BaseColor.wrapS = THREE.RepeatWrapping;
        tiles109BaseColor.wrapT = THREE.RepeatWrapping;
        tiles109BaseColor.colorSpace = THREE.SRGBColorSpace;
        tiles109BaseColor.anisotropy = 4;

        const tiles109BaseNormal = pbrTextureLoader.load('assets/textures/pbr/tiles109_normal.webp');
        tiles109BaseNormal.wrapS = THREE.RepeatWrapping;
        tiles109BaseNormal.wrapT = THREE.RepeatWrapping;
        tiles109BaseNormal.colorSpace = THREE.NoColorSpace;
        tiles109BaseNormal.anisotropy = 4;

        const tiles109BaseRoughness = pbrTextureLoader.load('assets/textures/pbr/tiles109_roughness.webp');
        tiles109BaseRoughness.wrapS = THREE.RepeatWrapping;
        tiles109BaseRoughness.wrapT = THREE.RepeatWrapping;
        tiles109BaseRoughness.colorSpace = THREE.NoColorSpace;
        tiles109BaseRoughness.anisotropy = 4;

        const tiles109BaseAo = pbrTextureLoader.load('assets/textures/pbr/tiles109_ao.webp');
        tiles109BaseAo.wrapS = THREE.RepeatWrapping;
        tiles109BaseAo.wrapT = THREE.RepeatWrapping;
        tiles109BaseAo.colorSpace = THREE.NoColorSpace;
        tiles109BaseAo.anisotropy = 4;

        function createTiles109FloorMaterial(repeatX = 16, repeatY = 16) {
            const colorTex = tiles109BaseColor.clone();
            colorTex.wrapS = THREE.RepeatWrapping;
            colorTex.wrapT = THREE.RepeatWrapping;
            colorTex.repeat.set(repeatX, repeatY);
            colorTex.colorSpace = THREE.SRGBColorSpace;
            colorTex.anisotropy = 4;
            colorTex.needsUpdate = true;

            const normalTex = tiles109BaseNormal.clone();
            normalTex.wrapS = THREE.RepeatWrapping;
            normalTex.wrapT = THREE.RepeatWrapping;
            normalTex.repeat.set(repeatX, repeatY);
            normalTex.colorSpace = THREE.NoColorSpace;
            normalTex.anisotropy = 4;
            normalTex.needsUpdate = true;

            const roughnessTex = tiles109BaseRoughness.clone();
            roughnessTex.wrapS = THREE.RepeatWrapping;
            roughnessTex.wrapT = THREE.RepeatWrapping;
            roughnessTex.repeat.set(repeatX, repeatY);
            roughnessTex.colorSpace = THREE.NoColorSpace;
            roughnessTex.anisotropy = 4;
            roughnessTex.needsUpdate = true;

            const aoTex = tiles109BaseAo.clone();
            aoTex.wrapS = THREE.RepeatWrapping;
            aoTex.wrapT = THREE.RepeatWrapping;
            aoTex.repeat.set(repeatX, repeatY);
            aoTex.colorSpace = THREE.NoColorSpace;
            aoTex.anisotropy = 4;
            aoTex.needsUpdate = true;

            return new THREE.MeshStandardMaterial({
                color: 0xffffff,
                map: colorTex,
                normalMap: normalTex,
                normalScale: new THREE.Vector2(0.85, 0.85),
                roughnessMap: roughnessTex,
                roughness: 0.85,
                aoMap: aoTex,
                aoMapIntensity: 1.0,
                metalness: 0.02
            });
        }

        const tiles109CourtyardFloorMat = createTiles109FloorMaterial(16, 16);

        // ── RUNDE RAUMWÄNDE MIT TÜREN ──
        function createCircularRoomWall(room) {
            const doorGap = 0.70;
            const wallArc = Math.PI * 2 - doorGap;

            if (room.name === "Lager") {
                // Aussenwand zum Hof hin: PBR-Plaster (FrontSide)
                const outerWallGeo = new THREE.CylinderGeometry(room.radius, room.radius, WALL_HEIGHT, 48, 1, true, doorGap / 2, wallArc);
                const outerWallMat = plasterRoomOuterWallMat;
                const outerWallMesh = new THREE.Mesh(outerWallGeo, outerWallMat);
                outerWallMesh.position.set(room.cx, WALL_HEIGHT / 2, room.cz);
                outerWallMesh.rotation.y = room.rotY;
                outerWallMesh.userData = {
                    isRoomWall: true,
                    roomName: room.name,
                    roomCenter: new THREE.Vector2(room.cx, room.cz),
                    radius: room.radius
                };
                scene.add(outerWallMesh);
                wallMeshes.push(outerWallMesh);

                // Innenseite: Ziegelsteinwand (Innenseite! BackSide)
                const innerWallGeo = new THREE.CylinderGeometry(room.radius - 0.005, room.radius - 0.005, WALL_HEIGHT, 48, 1, true, doorGap / 2, wallArc);
                const brickTex = createWarehouseBrickTexture();
                const innerWallMat = new THREE.MeshLambertMaterial({ map: brickTex, side: THREE.BackSide });
                const innerWallMesh = new THREE.Mesh(innerWallGeo, innerWallMat);
                innerWallMesh.position.set(room.cx, WALL_HEIGHT / 2, room.cz);
                innerWallMesh.rotation.y = room.rotY;
                innerWallMesh.userData = {
                    isRoomWall: true,
                    roomName: room.name,
                    roomCenter: new THREE.Vector2(room.cx, room.cz),
                    radius: room.radius - 0.005
                };
                scene.add(innerWallMesh);
                wallMeshes.push(innerWallMesh);
            } else if (room.name === "Chillen") {
                // Aussenwand zum Hof hin: PBR-Plaster (FrontSide)
                const outerWallGeo = new THREE.CylinderGeometry(room.radius, room.radius, WALL_HEIGHT, 48, 1, true, doorGap / 2, wallArc);
                const outerWallMat = plasterRoomOuterWallMat;
                const outerWallMesh = new THREE.Mesh(outerWallGeo, outerWallMat);
                outerWallMesh.position.set(room.cx, WALL_HEIGHT / 2, room.cz);
                outerWallMesh.rotation.y = room.rotY;
                outerWallMesh.userData = {
                    isRoomWall: true,
                    roomName: room.name,
                    roomCenter: new THREE.Vector2(room.cx, room.cz),
                    radius: room.radius
                };
                scene.add(outerWallMesh);
                wallMeshes.push(outerWallMesh);

                // Innenseite: Leicht koernige Wand (Innenseite! BackSide)
                const innerWallGeo = new THREE.CylinderGeometry(room.radius - 0.005, room.radius - 0.005, WALL_HEIGHT, 48, 1, true, doorGap / 2, wallArc);
                const grainyWallTex = createGrainyWallTexture();
                const innerWallMat = new THREE.MeshLambertMaterial({ map: grainyWallTex, side: THREE.BackSide });
                const innerWallMesh = new THREE.Mesh(innerWallGeo, innerWallMat);
                innerWallMesh.position.set(room.cx, WALL_HEIGHT / 2, room.cz);
                innerWallMesh.rotation.y = room.rotY;
                innerWallMesh.userData = {
                    isRoomWall: true,
                    roomName: room.name,
                    roomCenter: new THREE.Vector2(room.cx, room.cz),
                    radius: room.radius - 0.005
                };
                scene.add(innerWallMesh);
                wallMeshes.push(innerWallMesh);
            } else {
                // Alle weiteren Räume (Arbeit, Kunst, Gaming):
                // Aussenwand (zum Hof hin): PBR-Plaster (FrontSide)
                const outerWallGeo = new THREE.CylinderGeometry(room.radius, room.radius, WALL_HEIGHT, 48, 1, true, doorGap / 2, wallArc);
                const outerWallMat = plasterRoomOuterWallMat;
                const outerWallMesh = new THREE.Mesh(outerWallGeo, outerWallMat);
                outerWallMesh.position.set(room.cx, WALL_HEIGHT / 2, room.cz);
                outerWallMesh.rotation.y = room.rotY;
                outerWallMesh.userData = {
                    isRoomWall: true,
                    roomName: room.name,
                    roomCenter: new THREE.Vector2(room.cx, room.cz),
                    radius: room.radius
                };
                scene.add(outerWallMesh);
                wallMeshes.push(outerWallMesh);

                // Innenwand (im Raum): PBR-Plaster (BackSide)
                const innerWallGeo = new THREE.CylinderGeometry(room.radius - 0.005, room.radius - 0.005, WALL_HEIGHT, 48, 1, true, doorGap / 2, wallArc);
                const innerWallMat = plasterRoomInnerWallMat;
                const innerWallMesh = new THREE.Mesh(innerWallGeo, innerWallMat);
                innerWallMesh.position.set(room.cx, WALL_HEIGHT / 2, room.cz);
                innerWallMesh.rotation.y = room.rotY;
                innerWallMesh.userData = {
                    isRoomWall: true,
                    roomName: room.name,
                    roomCenter: new THREE.Vector2(room.cx, room.cz),
                    radius: room.radius - 0.005
                };
                scene.add(innerWallMesh);
                wallMeshes.push(innerWallMesh);
            }

            // TÃ¼rpfosten
            const pillarGeo = new THREE.CylinderGeometry(0.06, 0.06, WALL_HEIGHT, 16);
            const pillarMat = new THREE.MeshLambertMaterial({ color: 0x18181b });

            [-doorGap / 2, doorGap / 2].forEach((theta) => {
                const x_cyl = room.radius * Math.sin(theta);
                const z_cyl = room.radius * Math.cos(theta);

                const x_rot = x_cyl * Math.cos(room.rotY) + z_cyl * Math.sin(room.rotY);
                const z_rot = -x_cyl * Math.sin(room.rotY) + z_cyl * Math.cos(room.rotY);

                const pillar = new THREE.Mesh(pillarGeo, pillarMat);
                pillar.position.set(room.cx + x_rot, WALL_HEIGHT / 2, room.cz + z_rot);
                scene.add(pillar);
            });

// Raum-Decken komplett entfernt gegen Flackern

            // WeiÃŸes TÃ¼rschild Ã¼ber der TÃ¼r
            const doorPosAngle = room.doorAngle;
            const signX = room.cx + Math.cos(doorPosAngle) * (room.radius - 0.05);
            const signZ = room.cz + Math.sin(doorPosAngle) * (room.radius - 0.05);
            const signRotY = -doorPosAngle + Math.PI / 2;
            createDoorSign(room.name, signX, 4.4, signZ, signRotY);

            // Pinboard fÃ¼r RÃ¤ume auÃŸer Art
            if (room.name !== "Kunst") {
                createCurvedPinboard(room);
            }
        }

        // â”€â”€ PROZEDURALE TEXTUR-GENERATOREN (KRÃ„FTIGE MASERUNG, HOHER KONTRAST & RANDLOS) â”€â”€
        function createProceduralWoodTex(baseHex, darkHex, highlightHex, isPlanks) {
            const canvas = document.createElement("canvas");
            canvas.width = 512;
            canvas.height = 512;
            const ctx = canvas.getContext("2d");

            // Warme, satte Holzbasis
            ctx.fillStyle = baseHex;
            ctx.fillRect(0, 0, 512, 512);

            // Breitere, organische Jahresringe & Fladern mit hohem Kontrast (Schritt 14 statt 4)
            for (let y = 0; y <= 512; y += 14) {
                const waveAmp1 = 6.0;
                const waveAmp2 = 3.5;

                // Helles FrÃ¼hholzband
                if (highlightHex) {
                    ctx.strokeStyle = highlightHex;
                    ctx.lineWidth = 4.5;
                    ctx.globalAlpha = 0.55;
                    ctx.beginPath();
                    for (let x = 0; x <= 512; x += 16) {
                        const nx = (x / 512) * Math.PI * 2;
                        const wave = Math.sin(nx * 2 + y * 0.03) * waveAmp1 + Math.sin(nx * 5) * waveAmp2;
                        const py = y + wave + 2;
                        if (x === 0) ctx.moveTo(x, py);
                        else ctx.lineTo(x, py);
                    }
                    ctx.stroke();
                }

                // Dunkle SpÃ¤tholz-Linie mit hoher Deckkraft & SchÃ¤rfe
                ctx.strokeStyle = darkHex;
                ctx.lineWidth = (y % 42 === 0) ? 4.0 : 2.5;
                ctx.globalAlpha = (y % 42 === 0) ? 0.90 : 0.72;
                ctx.beginPath();
                for (let x = 0; x <= 512; x += 16) {
                    const nx = (x / 512) * Math.PI * 2;
                    const wave = Math.sin(nx * 2 + y * 0.03) * waveAmp1 + Math.sin(nx * 5) * waveAmp2;
                    const py = y + wave;
                    if (x === 0) ctx.moveTo(x, py);
                    else ctx.lineTo(x, py);
                }
                ctx.stroke();
            }

            // Holzporen & GefÃ¤ÃŸe entlang der Faserrichtung
            ctx.strokeStyle = darkHex;
            ctx.lineWidth = 1.0;
            ctx.globalAlpha = 0.35;
            for (let i = 0; i < 75; i++) {
                const px = Math.random() * 450;
                const py = Math.random() * 512;
                const plen = 20 + Math.random() * 50;
                ctx.beginPath();
                ctx.moveTo(px, py);
                ctx.lineTo(px + plen, py + (Math.sin(px * 0.05) * 1.5));
                ctx.stroke();
            }

            // Planken mit tiefen Schattenrillen & Lichtfasen
            if (isPlanks) {
                [128, 256, 384].forEach(px => {
                    ctx.globalAlpha = 0.92;
                    ctx.lineWidth = 3.5;
                    ctx.strokeStyle = "#100602";
                    ctx.beginPath();
                    ctx.moveTo(px, 0);
                    ctx.lineTo(px, 512);
                    ctx.stroke();

                    ctx.globalAlpha = 0.45;
                    ctx.lineWidth = 1.2;
                    ctx.strokeStyle = highlightHex || "#f59e0b";
                    ctx.beginPath();
                    ctx.moveTo(px + 2, 0);
                    ctx.lineTo(px + 2, 512);
                    ctx.stroke();
                });
            }
            ctx.globalAlpha = 1.0;

            const tex = new THREE.CanvasTexture(canvas);
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            tex.needsUpdate = true;
            return tex;
        }

        // Hochkontrastiger, plastischer Polsterstoff (Struktur-Gewebe mit Fadenkronen & Schattenrillen)
        function createProceduralUpholsteryTex(baseHex, darkHex, highlightHex, threadShadowHex) {
            const canvas = document.createElement("canvas");
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext("2d");

            ctx.fillStyle = baseHex;
            ctx.fillRect(0, 0, 256, 256);

            const tileSize = 32;
            for (let y = 0; y < 256; y += tileSize) {
                for (let x = 0; x < 256; x += tileSize) {
                    const isHorizontal = ((x / tileSize) + (y / tileSize)) % 2 === 0;

                    // Tiefe Rille zwischen Webelementen mit hohem Kontrast
                    ctx.strokeStyle = darkHex;
                    ctx.lineWidth = 3.0;
                    ctx.globalAlpha = 0.95;
                    ctx.strokeRect(x + 1, y + 1, tileSize - 2, tileSize - 2);

                    if (isHorizontal) {
                        for (let ty = y + 2; ty < y + tileSize - 2; ty += 5) {
                            ctx.fillStyle = threadShadowHex || darkHex;
                            ctx.globalAlpha = 0.95;
                            ctx.fillRect(x + 2, ty, tileSize - 4, 1.8);

                            ctx.fillStyle = baseHex;
                            ctx.globalAlpha = 1.0;
                            ctx.fillRect(x + 2, ty + 1.5, tileSize - 4, 2.8);

                            ctx.fillStyle = highlightHex;
                            ctx.globalAlpha = 0.95;
                            ctx.fillRect(x + 4, ty + 2, tileSize - 8, 1.8);
                        }
                    } else {
                        for (let tx = x + 2; tx < x + tileSize - 2; tx += 5) {
                            ctx.fillStyle = threadShadowHex || darkHex;
                            ctx.globalAlpha = 0.95;
                            ctx.fillRect(tx, y + 2, 1.8, tileSize - 4);

                            ctx.fillStyle = baseHex;
                            ctx.globalAlpha = 1.0;
                            ctx.fillRect(tx + 1.5, y + 2, 2.8, tileSize - 4);

                            ctx.fillStyle = highlightHex;
                            ctx.globalAlpha = 0.95;
                            ctx.fillRect(tx + 2, y + 4, 1.8, tileSize - 8);
                        }
                    }
                }
            }

            // Melange-Fasern mit starkem Kontrast
            ctx.globalAlpha = 0.30;
            for (let i = 0; i < 500; i++) {
                const rx = Math.random() * 256;
                const ry = Math.random() * 256;
                ctx.fillStyle = Math.random() > 0.4 ? highlightHex : darkHex;
                ctx.fillRect(rx, ry, 2, 2);
            }
            ctx.globalAlpha = 1.0;

            const tex = new THREE.CanvasTexture(canvas);
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            tex.needsUpdate = true;
            return tex;
        }

        // Passende Relief-Bump-Map fÃ¼r dynamische StoffplastizitÃ¤t
        function createProceduralUpholsteryBumpTex() {
            const canvas = document.createElement("canvas");
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext("2d");

            ctx.fillStyle = "#808080";
            ctx.fillRect(0, 0, 256, 256);

            const tileSize = 32;
            for (let y = 0; y < 256; y += tileSize) {
                for (let x = 0; x < 256; x += tileSize) {
                    const isHorizontal = ((x / tileSize) + (y / tileSize)) % 2 === 0;
                    ctx.strokeStyle = "#080808";
                    ctx.lineWidth = 3.0;
                    ctx.strokeRect(x + 1, y + 1, tileSize - 2, tileSize - 2);

                    if (isHorizontal) {
                        for (let ty = y + 2; ty < y + tileSize - 2; ty += 5) {
                            ctx.fillStyle = "#121212";
                            ctx.fillRect(x + 2, ty, tileSize - 4, 1.8);
                            ctx.fillStyle = "#ffffff";
                            ctx.fillRect(x + 4, ty + 2, tileSize - 8, 2.2);
                        }
                    } else {
                        for (let tx = x + 2; tx < x + tileSize - 2; tx += 5) {
                            ctx.fillStyle = "#121212";
                            ctx.fillRect(tx, y + 2, 1.8, tileSize - 4);
                            ctx.fillStyle = "#ffffff";
                            ctx.fillRect(tx + 2, y + 4, 2.2, tileSize - 8);
                        }
                    }
                }
            }

            const tex = new THREE.CanvasTexture(canvas);
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            tex.needsUpdate = true;
            return tex;
        }

        // GeprÃ¤gtes Waben-/Antirutsch-Muster fÃ¼r Yogamatte mit krÃ¤ftigem Kontrast
        function createProceduralYogaMatTex(baseHex, darkHex, highlightHex) {
            const canvas = document.createElement("canvas");
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext("2d");

            ctx.fillStyle = baseHex;
            ctx.fillRect(0, 0, 256, 256);

            const step = 16;
            ctx.lineWidth = 1.8;

            for (let y = -256; y < 512; y += step) {
                ctx.strokeStyle = darkHex;
                ctx.globalAlpha = 0.85;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(256, y + 256);
                ctx.stroke();

                ctx.strokeStyle = highlightHex;
                ctx.globalAlpha = 0.65;
                ctx.beginPath();
                ctx.moveTo(0, y + 1.8);
                ctx.lineTo(256, y + 256 + 1.8);
                ctx.stroke();

                ctx.strokeStyle = darkHex;
                ctx.globalAlpha = 0.85;
                ctx.beginPath();
                ctx.moveTo(256, y);
                ctx.lineTo(0, y + 256);
                ctx.stroke();

                ctx.strokeStyle = highlightHex;
                ctx.globalAlpha = 0.65;
                ctx.beginPath();
                ctx.moveTo(256, y + 1.8);
                ctx.lineTo(0, y + 256 + 1.8);
                ctx.stroke();
            }
            ctx.globalAlpha = 1.0;

            const tex = new THREE.CanvasTexture(canvas);
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            tex.needsUpdate = true;
            return tex;
        }

        // KrÃ¤ftige konzentrische Jahresringe (Schritt 14) bis Ã¼ber den Tischrand hinaus
        function createProceduralRadialWoodTex(baseHex, ringHex, highlightHex, poreHex) {
            const canvas = document.createElement("canvas");
            canvas.width = 512;
            canvas.height = 512;
            const ctx = canvas.getContext("2d");
            const cx = 256, cy = 256;

            ctx.fillStyle = baseHex;
            ctx.fillRect(0, 0, 512, 512);

            const grad = ctx.createRadialGradient(cx, cy, 15, cx, cy, 360);
            grad.addColorStop(0, "rgba(255, 255, 255, 0.12)");
            grad.addColorStop(0.65, "rgba(0, 0, 0, 0)");
            grad.addColorStop(1, "rgba(0, 0, 0, 0.45)");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 512, 512);

            // Breitere Jahresringe bis r = 380 mit deutlichem Kontrast
            for (let r = 8; r <= 380; r += 14) {
                if (highlightHex) {
                    ctx.strokeStyle = highlightHex;
                    ctx.lineWidth = 3.2;
                    ctx.globalAlpha = 0.50;
                    ctx.beginPath();
                    for (let a = 0; a <= Math.PI * 2; a += 0.08) {
                        const wobble = Math.sin(a * 4 + r * 0.15) * 2.8 + Math.cos(a * 7) * 1.5;
                        const x = cx + Math.cos(a) * (r + 1.5 + wobble);
                        const y = cy + Math.sin(a) * (r + 1.5 + wobble);
                        if (a === 0) ctx.moveTo(x, y);
                        else ctx.lineTo(x, y);
                    }
                    ctx.closePath();
                    ctx.stroke();
                }

                ctx.strokeStyle = ringHex;
                ctx.lineWidth = (r % 42 === 0) ? 4.2 : 2.5;
                ctx.globalAlpha = (r % 42 === 0) ? 0.88 : 0.68;
                ctx.beginPath();
                for (let a = 0; a <= Math.PI * 2; a += 0.08) {
                    const wobble = Math.sin(a * 4 + r * 0.15) * 2.8 + Math.cos(a * 7) * 1.5;
                    const x = cx + Math.cos(a) * (r + wobble);
                    const y = cy + Math.sin(a) * (r + wobble);
                    if (a === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.closePath();
                ctx.stroke();
            }

            // Markstrahlen / Poren
            ctx.strokeStyle = poreHex || "rgba(0, 0, 0, 0.38)";
            ctx.lineWidth = 1.2;
            ctx.globalAlpha = 0.32;
            for (let ray = 0; ray < 64; ray++) {
                const a = (ray / 64) * Math.PI * 2 + (Math.random() - 0.5) * 0.05;
                ctx.beginPath();
                ctx.moveTo(cx + Math.cos(a) * 15, cy + Math.sin(a) * 15);
                ctx.lineTo(cx + Math.cos(a) * 380, cy + Math.sin(a) * 380);
                ctx.stroke();
            }
            ctx.globalAlpha = 1.0;

            const tex = new THREE.CanvasTexture(canvas);
            tex.needsUpdate = true;
            return tex;
        }

        function createProceduralBrushedMetalTex(baseHex, scratchHex) {
            const canvas = document.createElement("canvas");
            canvas.width = 256;
            canvas.height = 128;
            const ctx = canvas.getContext("2d");

            ctx.fillStyle = baseHex;
            ctx.fillRect(0, 0, 256, 128);

            ctx.strokeStyle = scratchHex;
            ctx.globalAlpha = 0.38;
            ctx.lineWidth = 1.2;
            for (let i = 0; i < 65; i++) {
                const y = Math.random() * 128;
                const x = Math.random() * 180;
                const len = 35 + Math.random() * 70;
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineTo(x + len, y);
                ctx.stroke();
            }

            const tex = new THREE.CanvasTexture(canvas);
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            tex.needsUpdate = true;
            return tex;
        }

        // BÃ¼ndig bis an alle RÃ¤nder abschlieÃŸendes IDE-Display
        function createProceduralScreenTex() {
            const canvas = document.createElement("canvas");
            canvas.width = 512;
            canvas.height = 296;
            const ctx = canvas.getContext("2d");

            ctx.fillStyle = "#09090b";
            ctx.fillRect(0, 0, 512, 296);

            ctx.fillStyle = "#18181b";
            ctx.fillRect(0, 0, 512, 26);
            ctx.strokeStyle = "#27272a";
            ctx.strokeRect(0, 0, 512, 26);

            ["#ef4444", "#f59e0b", "#10b981"].forEach((col, idx) => {
                ctx.beginPath();
                ctx.arc(14 + idx * 14, 13, 4, 0, Math.PI * 2);
                ctx.fillStyle = col;
                ctx.fill();
            });

            ctx.fillStyle = "#27272a";
            ctx.fillRect(70, 4, 130, 22);
            ctx.fillStyle = "#38bdf8";
            ctx.font = 'bold 11px "Quicksand", monospace';
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText("mansion.ts", 82, 15);
            ctx.fillStyle = "#71717a";
            ctx.fillText("x", 185, 15);

            ctx.fillStyle = "#111113";
            ctx.fillRect(0, 26, 80, 246);
            ctx.strokeStyle = "#27272a";
            ctx.beginPath();
            ctx.moveTo(80, 26);
            ctx.lineTo(80, 272);
            ctx.stroke();

            ctx.font = '9px "Quicksand", monospace';
            ["EXPLORER", "v SRC", "  > models", "    chair.ts", "    tools.ts", "    notes.ts", "  app.ts", "package.json"].forEach((line, idx) => {
                ctx.fillStyle = line.includes(".ts") ? "#38bdf8" : "#71717a";
                ctx.fillText(line, 8, 42 + idx * 17);
            });

            const codeColors = ["#38bdf8", "#f43f5e", "#a855f7", "#22c55e", "#eab308", "#cbd5e1"];
            for (let row = 0; row < 12; row++) {
                const y = 44 + row * 19;
                ctx.fillStyle = "#3f3f46";
                ctx.font = '10px "Quicksand", monospace';
                ctx.textAlign = "right";
                ctx.fillText((row + 1).toString(), 105, y);

                let cx = 118 + (row % 3 === 0 ? 18 : (row % 4 === 0 ? 36 : 0));
                const tokens = 2 + (row * 5) % 4;
                for (let t = 0; t < tokens; t++) {
                    const tw = 22 + ((row + t) * 19) % 52;
                    ctx.fillStyle = codeColors[(row * 2 + t) % codeColors.length];
                    ctx.fillRect(cx, y - 8, tw, 9);
                    cx += tw + 8;
                }
            }

            ctx.fillStyle = "#111114";
            ctx.fillRect(460, 26, 52, 246);
            ctx.strokeStyle = "#27272a";
            ctx.beginPath();
            ctx.moveTo(460, 26);
            ctx.lineTo(460, 272);
            ctx.stroke();

            ctx.fillStyle = "rgba(56, 189, 248, 0.4)";
            for (let my = 32; my < 265; my += 5) {
                ctx.fillRect(466, my, 14 + (my % 28), 2.5);
            }

            ctx.fillStyle = "#0284c7";
            ctx.fillRect(0, 272, 512, 24);
            ctx.fillStyle = "#ffffff";
            ctx.font = 'bold 9px "Quicksand", monospace';
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText("main*  |  0 errors  0 warnings", 12, 284);
            ctx.textAlign = "right";
            ctx.fillText("UTF-8  |  TypeScript", 500, 284);

            const tex = new THREE.CanvasTexture(canvas);
            tex.needsUpdate = true;
            return tex;
        }

        // BÃ¼ndige Tastaturoberseite mit vollstÃ¤ndiger Tastenmatrix
        function createProceduralKeyboardTex() {
            const canvas = document.createElement("canvas");
            canvas.width = 512;
            canvas.height = 160;
            const ctx = canvas.getContext("2d");

            ctx.fillStyle = "#18181b";
            ctx.fillRect(0, 0, 512, 160);

            ctx.strokeStyle = "#27272a";
            ctx.lineWidth = 2;
            ctx.strokeRect(2, 2, 508, 156);

            const fKeys = ["ESC", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12", "DEL"];
            let fx = 8;
            fKeys.forEach(k => {
                const kw = k === "ESC" ? 30 : 28;
                ctx.fillStyle = k === "ESC" ? "#dc2626" : "#27272a";
                ctx.fillRect(fx, 6, kw, 18);
                ctx.strokeStyle = "#3f3f46";
                ctx.strokeRect(fx, 6, kw, 18);
                ctx.fillStyle = "#e4e4e7";
                ctx.font = 'bold 8px "Quicksand", monospace';
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(k, fx + kw / 2, 15);
                fx += kw + 6;
            });

            const keyRows = [
                ["~", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "+", "BKSP"],
                ["TAB", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]", "\\\\"],
                ["CAPS", "A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'", "ENTER"],
                ["SHIFT", "Z", "X", "C", "V", "B", "N", "M", ",", ".", "/", "SHIFT", "UP"],
                ["CTRL", "WIN", "ALT", "SPACE", "ALT", "FN", "LEFT", "DOWN", "RIGHT"]
            ];

            const rowY = [28, 54, 80, 106, 132];
            keyRows.forEach((row, rIdx) => {
                let x = 8;
                const y = rowY[rIdx];
                row.forEach(k => {
                    let kw = 28;
                    if (k === "BKSP") kw = 48;
                    else if (k === "TAB") kw = 42;
                    else if (k === "CAPS") kw = 46;
                    else if (k === "ENTER") kw = 56;
                    else if (k === "SHIFT") kw = 52;
                    else if (k === "SPACE") kw = 176;
                    else if (k === "CTRL" || k === "ALT" || k === "WIN" || k === "FN") kw = 34;

                    ctx.fillStyle = (k === "ENTER" || k === "SPACE") ? "#3f3f46" : "#27272a";
                    ctx.fillRect(x, y, kw, 22);
                    ctx.strokeStyle = "#52525b";
                    ctx.lineWidth = 1;
                    ctx.strokeRect(x, y, kw, 22);

                    ctx.fillStyle = "#e4e4e7";
                    ctx.font = 'bold 8px "Quicksand", monospace';
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(k === "SPACE" ? "" : k, x + kw / 2, y + 11);

                    x += kw + 5;
                });
            });

            ["#10b981", "#3b82f6", "#ef4444"].forEach((col, idx) => {
                ctx.beginPath();
                ctx.arc(488 + idx * 8, 12, 2.5, 0, Math.PI * 2);
                ctx.fillStyle = col;
                ctx.fill();
            });

            const tex = new THREE.CanvasTexture(canvas);
            tex.needsUpdate = true;
            return tex;
        }

        // Buchdeckel oben (GoldprÃ¤gung auf Leder mit hohem Kontrast)
        function createProceduralBookCoverTex() {
            const canvas = document.createElement("canvas");
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext("2d");

            ctx.fillStyle = "#090d16";
            ctx.fillRect(0, 0, 256, 256);

            ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
            for (let i = 0; i < 400; i++) {
                ctx.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
            }

            ctx.strokeStyle = "#facc15";
            ctx.lineWidth = 3.5;
            ctx.strokeRect(8, 8, 240, 240);
            ctx.lineWidth = 1.2;
            ctx.strokeRect(15, 15, 226, 226);

            [[15, 15], [241, 15], [15, 241], [241, 241]].forEach(([cx, cy]) => {
                ctx.fillStyle = "#fef08a";
                ctx.beginPath();
                ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
                ctx.fill();
            });

            ctx.fillStyle = "#fef08a";
            ctx.font = 'bold 24px "Quicksand", serif';
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("MANSION", 128, 110);
            ctx.font = 'bold 13px "Quicksand", sans-serif';
            ctx.fillStyle = "#facc15";
            ctx.fillText("ARCHIV", 128, 145);

            const tex = new THREE.CanvasTexture(canvas);
            tex.needsUpdate = true;
            return tex;
        }

        // BuchrÃ¼cken mit krÃ¤ftigen Goldrippen & Schrift
        function createProceduralBookSpineTex() {
            const canvas = document.createElement("canvas");
            canvas.width = 256;
            canvas.height = 64;
            const ctx = canvas.getContext("2d");

            ctx.fillStyle = "#090d16";
            ctx.fillRect(0, 0, 256, 64);

            [35, 85, 171, 221].forEach(x => {
                ctx.fillStyle = "#1e293b";
                ctx.fillRect(x - 5, 0, 10, 64);
                ctx.fillStyle = "#facc15";
                ctx.fillRect(x - 1.5, 0, 3, 64);
            });

            ctx.save();
            ctx.translate(128, 32);
            ctx.fillStyle = "#fef08a";
            ctx.font = 'bold 13px "Quicksand", serif';
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("MANSION", 0, 0);
            ctx.restore();

            const tex = new THREE.CanvasTexture(canvas);
            tex.needsUpdate = true;
            return tex;
        }

        // Buchseiten mit Papierschichten
        function createProceduralBookPagesTex() {
            const canvas = document.createElement("canvas");
            canvas.width = 256;
            canvas.height = 64;
            const ctx = canvas.getContext("2d");

            ctx.fillStyle = "#fef9c3";
            ctx.fillRect(0, 0, 256, 64);

            ctx.strokeStyle = "#b45309";
            ctx.lineWidth = 1;
            ctx.globalAlpha = 0.40;
            for (let y = 2; y < 64; y += 3) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(256, y);
                ctx.stroke();
            }
            ctx.globalAlpha = 1.0;

            const tex = new THREE.CanvasTexture(canvas);
            tex.needsUpdate = true;
            return tex;
        }

        function createProceduralMarkerTex() {
            const canvas = document.createElement("canvas");
            canvas.width = 256;
            canvas.height = 64;
            const ctx = canvas.getContext("2d");

            ctx.fillStyle = "#ccff00";
            ctx.fillRect(0, 0, 256, 64);

            ctx.fillStyle = "#111111";
            ctx.font = 'bold 16px "Quicksand", sans-serif';
            ctx.textBaseline = "middle";
            ctx.fillText("HIGHLIGHTER", 30, 32);
            ctx.font = '9px "Quicksand", sans-serif';
            ctx.fillText("FLUORESCENT // PERMANENT", 30, 48);

            for (let bx = 180; bx < 240; bx += 3) {
                ctx.fillRect(bx, 18, (bx % 6 === 0 ? 2 : 1), 28);
            }

            const tex = new THREE.CanvasTexture(canvas);
            tex.needsUpdate = true;
            return tex;
        }

        // â”€â”€ MAáºžSTABSGETREUE UV-SKALIERUNG NACH OBJEKTMAáºžEN â”€â”€
        function adjustBoxGeometryUVs(geo, width, height, depth, scaleU = 1.0, scaleV = 1.0) {
            const uvAttr = geo.attributes.uv;
            const uv = uvAttr.array;

            const faces = [
                { w: depth, h: height }, // Face 0: +X
                { w: depth, h: height }, // Face 1: -X
                { w: width, h: depth },  // Face 2: +Y
                { w: width, h: depth },  // Face 3: -Y
                { w: width, h: height }, // Face 4: +Z
                { w: width, h: height }, // Face 5: -Z
            ];

            for (let f = 0; f < 6; f++) {
                const fw = faces[f].w * scaleU;
                const fh = faces[f].h * scaleV;
                const base = f * 8;
                uv[base + 0] = 0;  uv[base + 1] = fh;
                uv[base + 2] = fw; uv[base + 3] = fh;
                uv[base + 4] = 0;  uv[base + 5] = 0;
                uv[base + 6] = fw; uv[base + 7] = 0;
            }
            uvAttr.needsUpdate = true;
        }

        function createDimensionBoxGeometry(width, height, depth, scaleU = 1.0, scaleV = 1.0) {
            const geo = new THREE.BoxGeometry(width, height, depth);
            adjustBoxGeometryUVs(geo, width, height, depth, scaleU, scaleV);
            return geo;
        }

        // 1. ARBEIT (Nord) - 4 INDIVIDUELLE ARBEITS- & SITZBEREICHE
        function buildArbeitsraum() {
            const rx = 0, rz = -16.5;

            const floorGeo = new THREE.CircleGeometry(5.42, 48);
            const floorMat = new THREE.MeshBasicMaterial({ color: 0x141416 });
            const floor = new THREE.Mesh(floorGeo, floorMat);
            floor.rotation.x = -Math.PI / 2;
            floor.position.set(rx, 0.015, rz);
            scene.add(floor);

            // Keine Punktbeleuchtung

            // 1. GroÃŸe Werkbank mit Hammer, SchraubenschlÃ¼ssel, Sichel, Pinsel & gelbem Schemel

            // 2. Blaue Yogamatte mit 2 Kurzhanteln

            // 3. Schreibtisch mit PC-Setup & rotem BÃ¼rostuhl

            // 4. Hellgrauer Lesesessel mit Beistelltisch (Buch, 3D-Brille, neongelber Marker)
        }

        // â”€â”€ 1. WERKBANK MIT WERKZEUGEN & GELBEM SCHEMEL â”€â”€

        // â”€â”€ 2. BLAUE YOGAMATTE MIT 2 HANTELN â”€â”€

        // â”€â”€ 3. SCHREIBTISCH MIT ROTEM BÃœROSTUHL â”€â”€

        // â”€â”€ 4. HELLGRAUER LESESESSEL MIT BEISTELLTISCH (BUCH, 3D-BRILLE, NEON-MARKER) â”€â”€

        // 2. CHILLEN (Sued-Ost, Pentagon-Position bei rx = 9.698, rz = 13.349)
        // â”€â”€ SCHLICHTER, ELEGANTER PARKETTBODEN FUER DEN CHILLEN-RAUM (MINIMALISTISCH) â”€â”€
        function createSimpleParquetTexture() {
            const canvas = document.createElement("canvas");
            canvas.width = 512;
            canvas.height = 512;
            const ctx = canvas.getContext("2d");

            // Warmer, harmonischer Eichenholz-Grundton
            ctx.fillStyle = "#b89060";
            ctx.fillRect(0, 0, 512, 512);

            const numCols = 6;
            const plankW = 512 / numCols;
            const plankH = 256;

            // Sehr dezente, ruhige Helligkeitsvariation im Halbversatz (kein unruhiger Farbmix)
            for (let c = 0; c < numCols; c++) {
                const x = c * plankW;
                const offset = (c % 2 === 1) ? 128 : 0;
                for (let y = -plankH + offset; y < 512 + plankH; y += plankH) {
                    if ((c + (y > 100 ? 1 : 0)) % 2 === 0) {
                        ctx.fillStyle = "rgba(0, 0, 0, 0.035)";
                        ctx.fillRect(x, y, plankW, plankH);
                    }
                }
            }

            // Sehr feine, dezente Fugenlinien
            ctx.strokeStyle = "rgba(50, 30, 15, 0.25)";
            ctx.lineWidth = 1.5;

            // Laengsfugen
            for (let c = 0; c <= numCols; c++) {
                const x = c * plankW;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, 512);
                ctx.stroke();
            }

            // Querfugen im Halbversatz
            for (let c = 0; c < numCols; c++) {
                const x = c * plankW;
                const offset = (c % 2 === 1) ? 128 : 0;
                for (let y = offset; y <= 512; y += plankH) {
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + plankW, y);
                    ctx.stroke();
                }
            }

            const texture = new THREE.CanvasTexture(canvas);
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(3, 3);
            return texture;
        }

        function buildChillenRaum() {
            const rx = 9.698, rz = 13.349;
            const dRot = 0.6283185; // Drehung um +36 Grad

            function rot(dx, dz) {
                const c = Math.cos(dRot), s = Math.sin(dRot);
                return { x: dx * c + dz * s, z: -dx * s + dz * c };
            }

            // 1. Einfacher warmer Parkettboden (trotz Teppich)
            const floorGeo = new THREE.CircleGeometry(5.42, 48);
            const parquetTex = createSimpleParquetTexture();
            const floorMat = new THREE.MeshStandardMaterial({
                map: parquetTex,
                roughness: 0.70,
                metalness: 0.02
            });
            const floor = new THREE.Mesh(floorGeo, floorMat);
            floor.rotation.x = -Math.PI / 2;
            floor.position.set(rx, 0.015, rz);
            scene.add(floor);

            // Roter runder Teppich
            const rugGeo = new THREE.CircleGeometry(3.4, 48);
            const rugMat = new THREE.MeshLambertMaterial({ color: 0x991b1b, side: THREE.DoubleSide });
            const rug = new THREE.Mesh(rugGeo, rugMat);
            rug.rotation.x = -Math.PI / 2;
            rug.position.set(rx, 0.022, rz);
            scene.add(rug);

            // Gelber Tisch
            const tableGroup = new THREE.Group();
            const yellowMat = new THREE.MeshLambertMaterial({ color: 0xfacc15 });
            const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.06, 32), yellowMat);
            tableTop.position.y = 0.46;
            tableGroup.add(tableTop);

            const tableLegMat = new THREE.MeshLambertMaterial({ color: 0x18181b });
            const tableLegGeo = new THREE.CylinderGeometry(0.025, 0.02, 0.46, 12);
            [[-0.65, -0.65], [0.65, -0.65], [-0.65, 0.65], [0.65, 0.65]].forEach(([lx, lz]) => {
                const leg = new THREE.Mesh(tableLegGeo, tableLegMat);
                leg.position.set(lx, 0.23, lz);
                tableGroup.add(leg);
            });

            const rTable = rot(0, 0.4);
            tableGroup.position.set(rx + rTable.x, 0, rz + rTable.z);
            tableGroup.rotation.y = dRot;
            scene.add(tableGroup);

            // â”€â”€ MINI-TRIPOD (STATIV) AUF DEM GELBEN TISCH â”€â”€
            const tripodGroup = new THREE.Group();
            const tripodMat = new THREE.MeshLambertMaterial({ color: 0x18181b });
            const tripodMetalMat = new THREE.MeshLambertMaterial({ color: 0x94a3b8 });

            // Zentraler Stativ-Hub
            const tripodHub = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.045, 0.04, 16), tripodMat);
            tripodHub.position.set(0, 0.14, 0);
            tripodGroup.add(tripodHub);

            // Kugelkopf (silberne Gelenkkugel)
            const tripodBall = new THREE.Mesh(new THREE.SphereGeometry(0.032, 16, 12), tripodMetalMat);
            tripodBall.position.set(0, 0.175, 0);
            tripodGroup.add(tripodBall);

            // Schnellwechselplatte / Stativteller
            const tripodPlate = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.015, 16), tripodMat);
            tripodPlate.position.set(0, 0.20, 0);
            tripodGroup.add(tripodPlate);

            // 3 Stativbeine mit Gummifuessen (spreizen sich auf die Tischplatte)
            const legLen = 0.26;
            const legGeo = new THREE.CylinderGeometry(0.011, 0.016, legLen, 12);
            legGeo.translate(0, -legLen / 2, 0);
            const rubberFootGeo = new THREE.SphereGeometry(0.018, 12, 10);
            const footRubberMat = new THREE.MeshBasicMaterial({ color: 0x09090b });

            [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].forEach(angle => {
                const legPivot = new THREE.Group();
                legPivot.position.set(0, 0.14, 0);
                legPivot.rotation.y = angle;

                const legMesh = new THREE.Mesh(legGeo, tripodMat);
                legMesh.rotation.z = 0.98;
                legPivot.add(legMesh);

                const footMesh = new THREE.Mesh(rubberFootGeo, footRubberMat);
                footMesh.position.set(Math.sin(0.98) * legLen, -Math.cos(0.98) * legLen, 0);
                legPivot.add(footMesh);

                tripodGroup.add(legPivot);
            });

            // Auf dem Tisch platziert
            const rTripod = rot(-0.25, 0.35);
            tripodGroup.position.set(rx + rTripod.x, 0.49, rz + rTripod.z);
            tripodGroup.rotation.y = dRot;
            scene.add(tripodGroup);

            // â”€â”€ KINOPROJEKTOR AUF DEM STATIV â”€â”€
            const projectorGroup = new THREE.Group();

            // Gehaeuse (edles anthrazitfarbenes Schiefergrau)
            const projBodyMat = new THREE.MeshLambertMaterial({ color: 0x27272a });
            const projBody = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.14, 0.32), projBodyMat);
            projBody.position.y = 0.07;
            projectorGroup.add(projBody);

            // Stativ-Montagering an der Unterseite
            const mountRing = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.015, 16), tripodMetalMat);
            mountRing.position.y = -0.005;
            projectorGroup.add(mountRing);

            // Objektiv-Tubus (vorne bei local +Z)
            const lensRimMat = new THREE.MeshLambertMaterial({ color: 0x71717a });
            const lensRim = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.055, 24), lensRimMat);
            lensRim.rotation.x = Math.PI / 2;
            lensRim.position.set(0.08, 0.07, 0.16);
            projectorGroup.add(lensRim);

            // Glaslinse
            const lensGlassMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
            const lensGlass = new THREE.Mesh(new THREE.SphereGeometry(0.050, 16, 12), lensGlassMat);
            lensGlass.position.set(0.08, 0.07, 0.18);
            projectorGroup.add(lensGlass);

            // Status-LED (oben)
            const ledMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
            projectorLedMesh = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), ledMat);
            projectorLedMesh.position.set(-0.14, 0.142, -0.09);
            projectorGroup.add(projectorLedMesh);

            // Lichtstrahl-Effekt mit stufenlosem Ausfaden
            const beamLen = 2.40;
            const beamGeo = new THREE.CylinderGeometry(0.72, 0.055, beamLen, 32, 16, true);
            beamGeo.translate(0, beamLen / 2, 0);
            beamGeo.rotateX(Math.PI / 2);

            const beamMat = new THREE.ShaderMaterial({
                uniforms: {
                    uColor: { value: new THREE.Color(0xe0f2fe) },
                    uOpacity: { value: 0.28 }
                },
                vertexShader: [
                    'varying float vDist;',
                    'void main() {',
                    '    vDist = position.z;',
                    '    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
                    '}'
                ].join('\n'),
                fragmentShader: [
                    'uniform vec3 uColor;',
                    'uniform float uOpacity;',
                    'varying float vDist;',
                    'void main() {',
                    '    float normDist = clamp(vDist / 2.40, 0.0, 1.0);',
                    '    float fade = pow(1.0 - normDist, 1.7);',
                    '    gl_FragColor = vec4(uColor, uOpacity * fade);',
                    '}'
                ].join('\n'),
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide
            });

            projectorBeamMesh = new THREE.Mesh(beamGeo, beamMat);
            projectorBeamMesh.position.set(0.08, 0.07, 0.195);
            projectorBeamMesh.visible = false;
            projectorGroup.add(projectorBeamMesh);

            // Linse-Leuchtpunkt
            const flareGeo = new THREE.CircleGeometry(0.065, 16);
            const flareMat = new THREE.MeshBasicMaterial({
                color: 0xf0f9ff,
                transparent: true,
                opacity: 0.75,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide
            });
            projectorFlareMesh = new THREE.Mesh(flareGeo, flareMat);
            projectorFlareMesh.position.set(0.08, 0.07, 0.20);
            projectorFlareMesh.visible = false;
            projectorGroup.add(projectorFlareMesh);

            // Montage direkt auf dem Kugelkopf-Stativteller
            const rProj = rot(-0.25, 0.35);
            projectorGroup.position.set(rx + rProj.x, 0.70, rz + rProj.z);

            // â”€â”€ VIEWING SCREEN (GRAUE 2D-LEINWAND, WANDFARBE, "Video") â”€â”€
            const csWidth = 5.00;
            const csHeight = 2.81;

            const csCanvas = document.createElement("canvas");
            csCanvas.width = 1536;
            csCanvas.height = 864;
            const csCtx = csCanvas.getContext("2d");

            // Schicker dunkler Kinobildschirm mit feinem Rahmen
            csCtx.fillStyle = "#18181b";
            csCtx.fillRect(0, 0, 1536, 864);

            csCtx.lineWidth = 24;
            csCtx.strokeStyle = "#09090b";
            csCtx.strokeRect(12, 12, 1536 - 24, 864 - 24);

            csCtx.fillStyle = "rgba(255, 255, 255, 0.35)";
            csCtx.font = 'bold 56px "Quicksand", sans-serif';
            csCtx.textAlign = "center";
            csCtx.textBaseline = "middle";
            csCtx.fillText("HEIMKINO", 1536 / 2, 864 / 2 - 24);

            csCtx.font = '500 28px "Quicksand", sans-serif';
            csCtx.fillStyle = "rgba(255, 255, 255, 0.22)";
            csCtx.fillText("Bedienpult rechts an der Wand verwenden", 1536 / 2, 864 / 2 + 36);

            const csTexture = new THREE.CanvasTexture(csCanvas);
            csTexture.colorSpace = THREE.SRGBColorSpace;
            csTexture.needsUpdate = true;

            const csGeo = new THREE.PlaneGeometry(csWidth, csHeight);
            const csMat = new THREE.MeshLambertMaterial({
                map: csTexture,
                side: THREE.DoubleSide
            });
            cinemaScreenMesh = new THREE.Mesh(csGeo, csMat);

            const rScreen = rot(-4.75, 0);
            cinemaScreenMesh.position.set(rx + rScreen.x, 2.35, rz + rScreen.z);
            cinemaScreenMesh.rotation.y = Math.PI / 2 + dRot;
            cinemaScreenMesh.userData = { isCinemaScreen: true };
            scene.add(cinemaScreenMesh);

            // Exakt auf die Kinoleinwand ausgerichtet
            projectorGroup.lookAt(cinemaScreenMesh.position.x, 2.35, cinemaScreenMesh.position.z);
            scene.add(projectorGroup);

            // Interaktions-Volumen fuer verlaessliches Raycasting
            const rInteract = rot(-4.73, 0);
            cinemaInteractMesh = new THREE.Mesh(
                new THREE.PlaneGeometry(csWidth, csHeight),
                new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
            );
            cinemaInteractMesh.position.set(rx + rInteract.x, 2.35, rz + rInteract.z);
            cinemaInteractMesh.rotation.y = Math.PI / 2 + dRot;
            cinemaInteractMesh.userData = { isCinemaScreen: true };
            scene.add(cinemaInteractMesh);

            // Dunkelblaue Polstercouch fuer 4 Personen
            const couchGroup = new THREE.Group();
            const blueMat = new THREE.MeshLambertMaterial({ color: 0x1e3a8a });
            const cushionMat = new THREE.MeshLambertMaterial({ color: 0x1d4ed8 });

            const couchBase = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.22, 1.1), blueMat);
            couchBase.position.y = 0.11;
            couchGroup.add(couchBase);

            const couchBack = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.70, 0.25), blueMat);
            couchBack.position.set(0, 0.55, 0.42);
            couchGroup.add(couchBack);

            const armGeo = new THREE.BoxGeometry(0.24, 0.45, 1.1);
            const armL = new THREE.Mesh(armGeo, blueMat);
            armL.position.set(-2.15, 0.42, 0);
            couchGroup.add(armL);
            const armR = new THREE.Mesh(armGeo, blueMat);
            armR.position.set(2.15, 0.42, 0);
            couchGroup.add(armR);

            const cushionWidth = 0.95;
            const cushionX = [-1.42, -0.47, 0.47, 1.42];

            const rCouch = rot(0, 3.4);
            couchGroup.position.set(rx + rCouch.x, 0, rz + rCouch.z);
            couchGroup.rotation.y = dRot;

            cushionX.forEach((cx, idx) => {
                const cushionGeo = new THREE.BoxGeometry(cushionWidth, 0.18, 0.78);
                const cushionMesh = new THREE.Mesh(cushionGeo, cushionMat);
                cushionMesh.position.set(cx, 0.31, -0.08);
                couchGroup.add(cushionMesh);

                const rCushion = rot(cx, 3.4 - 0.08);
                const seatWorldPos = new THREE.Vector3(rx + rCushion.x, 1.10, rz + rCushion.z);
                const lookDir = new THREE.Vector3(-Math.sin(dRot), 0, -Math.cos(dRot));
                registerSeat(cushionMesh, `Blaue Couch (Platz ${idx + 1})`, seatWorldPos, lookDir);
            });
            scene.add(couchGroup);

            // Stehlampe
            const lampGroup = new THREE.Group();

            const lampBase = new THREE.Mesh(
                new THREE.CylinderGeometry(0.22, 0.24, 0.03, 16),
                new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.4, metalness: 0.8 })
            );
            lampBase.position.y = 0.015;
            lampGroup.add(lampBase);

            const lampPole = new THREE.Mesh(
                new THREE.CylinderGeometry(0.022, 0.022, 2.1, 12),
                new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.3, metalness: 0.85 })
            );
            lampPole.position.y = 1.05;
            lampGroup.add(lampPole);

            chillenLampShadeMat = new THREE.MeshStandardMaterial({
                color: 0xfef08a,
                side: THREE.DoubleSide,
                roughness: 0.35,
                emissive: 0x000000,
                emissiveIntensity: 0.0
            });
            const lampShade = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.46, 24, 1, true), chillenLampShadeMat);
            lampShade.position.y = 2.05;
            lampGroup.add(lampShade);

            const lampBulb = new THREE.Mesh(
                new THREE.SphereGeometry(0.07, 16, 16),
                new THREE.MeshBasicMaterial({ color: 0xfffbeb })
            );
            lampBulb.position.y = 1.95;
            lampGroup.add(lampBulb);

            chillenLampLight = new THREE.PointLight(0xffe29a, 3.8, 14, 1.4);
            chillenLampLight.position.set(0, 1.95, 0);
            chillenLampLight.visible = false;
            lampGroup.add(chillenLampLight);

            chillenLampInteractMesh = new THREE.Mesh(
                new THREE.CylinderGeometry(0.48, 0.48, 2.3, 12),
                new THREE.MeshBasicMaterial({ visible: false })
            );
            chillenLampInteractMesh.position.y = 1.15;
            chillenLampInteractMesh.userData = { isChillenLamp: true };
            lampGroup.add(chillenLampInteractMesh);

            const rLamp = rot(3.8, 2.8);
            lampGroup.position.set(rx + rLamp.x, 0, rz + rLamp.z);
            lampGroup.rotation.y = dRot;
            scene.add(lampGroup);

            // 3D-Bedienpult an der Wand & CSS3D Cinema initialisieren
            createCinemaControlPanel(rx, rz, dRot);
            initCSS3DCinema();
        }

        // 3. GAMING (Sued-West, Pentagon-Position bei rx = -9.698, rz = 13.349)
        function buildGamingRaum() {
            const rx = -9.698, rz = 13.349;
            const dRot = 0.9424778; // Drehung um +54 Grad

            function rot(dx, dz) {
                const c = Math.cos(dRot), s = Math.sin(dRot);
                return { x: dx * c + dz * s, z: -dx * s + dz * c };
            }

            // Dunkler runder Bodenbelag
            const floorGeo = new THREE.CircleGeometry(5.42, 48);
            const floorMat = new THREE.MeshBasicMaterial({ color: 0x09090b });
            const floor = new THREE.Mesh(floorGeo, floorMat);
            floor.rotation.x = -Math.PI / 2;
            floor.position.set(rx, 0.015, rz);
            scene.add(floor);
        }

        // 4. ART (Ost-Nord-Ost, Pentagon-Position bei rx = 15.692, rz = -5.099)
        function buildArtRaum() {
            const rx = 15.692, rz = -5.099;
            const dRot = 0.3141593; // Drehung um +18 Grad

            function rot(dx, dz) {
                const c = Math.cos(dRot), s = Math.sin(dRot);
                return { x: dx * c + dz * s, z: -dx * s + dz * c };
            }

            const floorGeo = new THREE.CircleGeometry(5.42, 48);
            const floorMat = new THREE.MeshLambertMaterial({ color: 0xf5f5f7 });
            const floor = new THREE.Mesh(floorGeo, floorMat);
            floor.rotation.x = -Math.PI / 2;
            floor.position.set(rx, 0.015, rz);
            scene.add(floor);



            // Zentrales Marmorpodest
            const pedestal = new THREE.Mesh(
                new THREE.BoxGeometry(1.3, 0.9, 1.3),
                new THREE.MeshLambertMaterial({ color: 0xffffff })
            );
            pedestal.position.set(rx, 0.45, rz);
            scene.add(pedestal);

            // Animiertes golden-cyan TorusKnot Kunstwerk
            const sculptureGeo = new THREE.TorusKnotGeometry(0.55, 0.18, 64, 16);
            const sculptureMat = new THREE.MeshStandardMaterial({
                color: 0x06b6d4,
                emissive: 0x0284c7,
                emissiveIntensity: 0.55,
                metalness: 0.85,
                roughness: 0.15
            });
            artSculpture = new THREE.Mesh(sculptureGeo, sculptureMat);
            artSculpture.position.set(rx, 1.75, rz);
            scene.add(artSculpture);

            // Galerie-Sitzbank
            const benchGroup = new THREE.Group();
            const benchSeat = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.65), new THREE.MeshLambertMaterial({ color: 0x27272a }));
            benchSeat.position.y = 0.48;
            benchGroup.add(benchSeat);

            const bLegMat = new THREE.MeshLambertMaterial({ color: 0x52525b });
            [-0.95, 0.95].forEach((bx) => {
                const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.48), bLegMat);
                leg.position.set(bx, 0.24, 0);
                benchGroup.add(leg);
            });

            const rBench = rot(3.2, 0);
            benchGroup.position.set(rx + rBench.x, 0, rz + rBench.z);
            benchGroup.rotation.y = -Math.PI / 2 + dRot;
            scene.add(benchGroup);

            const rBenchSit = rot(3.0, 0);
            registerSeat(benchSeat, "Galerie-Sitzbank", new THREE.Vector3(rx + rBenchSit.x, 1.15, rz + rBenchSit.z), new THREE.Vector3(-Math.cos(dRot), 0, Math.sin(dRot)));
        }

        // 5. LAGER (SONST LEER BIS AUF STUEHLE, EINZELNE LAMPE MIT LICHTKEGEL & MUECKEN)
        function createMosquitoTexture() {
            const canvas = document.createElement("canvas");
            canvas.width = 32;
            canvas.height = 32;
            const ctx = canvas.getContext("2d");

            // Weiche Leucht-Aura (Muecke im warmen Lichtstrahl)
            const grad = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
            grad.addColorStop(0, "rgba(254, 240, 138, 1.0)");
            grad.addColorStop(0.35, "rgba(253, 224, 71, 0.7)");
            grad.addColorStop(0.7, "rgba(250, 204, 21, 0.25)");
            grad.addColorStop(1, "rgba(250, 204, 21, 0.0)");
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(16, 16, 15, 0, Math.PI * 2);
            ctx.fill();

            // Dunkler Insektenkoerper in der Mitte
            ctx.fillStyle = "#18181b";
            ctx.beginPath();
            ctx.ellipse(16, 16, 3.5, 2.0, Math.PI / 4, 0, Math.PI * 2);
            ctx.fill();

            const tex = new THREE.CanvasTexture(canvas);
            tex.colorSpace = THREE.SRGBColorSpace;
            return tex;
        }

        function buildWarehouseMosquitoes(rx, rz) {
            const count = 45;
            const geo = new THREE.BufferGeometry();
            const positions = new Float32Array(count * 3);
            const data = [];

            for (let i = 0; i < count; i++) {
                const baseR = 0.20 + Math.random() * 1.55;
                const baseY = 1.25 + Math.random() * 1.70;
                const angle = Math.random() * Math.PI * 2;
                data.push({
                    baseR: baseR,
                    baseY: baseY,
                    angle: angle,
                    rotSpeed: (0.35 + Math.random() * 0.45) * (Math.random() > 0.5 ? 1 : -1),
                    flutterFreq: 8.0 + Math.random() * 6.0,
                    flutterAmp: 0.018 + Math.random() * 0.015,
                    wanderFreqX: 0.35 + Math.random() * 0.45,
                    wanderFreqY: 0.30 + Math.random() * 0.40,
                    wanderFreqZ: 0.35 + Math.random() * 0.45,
                    phaseX: Math.random() * Math.PI * 2,
                    phaseY: Math.random() * Math.PI * 2,
                    phaseZ: Math.random() * Math.PI * 2
                });

                positions[i * 3] = rx + baseR * Math.cos(angle);
                positions[i * 3 + 1] = baseY;
                positions[i * 3 + 2] = rz + baseR * Math.sin(angle);
            }

            geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

            const mat = new THREE.PointsMaterial({
                size: 0.055,
                map: createMosquitoTexture(),
                transparent: true,
                opacity: 0.90,
                depthWrite: false,
                blending: THREE.NormalBlending,
                sizeAttenuation: true
            });

            const points = new THREE.Points(geo, mat);
            points.renderOrder = 995;
            scene.add(points);

            warehouseMosquitoes = {
                points: points,
                geo: geo,
                positions: positions,
                data: data,
                rx: rx,
                rz: rz
            };
        }

        function updateWarehouseMosquitoes(delta) {
            if (!warehouseMosquitoes) return;
            const t = clock.getElapsedTime ? clock.getElapsedTime() : performance.now() * 0.001;
            const { positions, data, rx, rz, geo } = warehouseMosquitoes;

            for (let i = 0; i < data.length; i++) {
                const m = data[i];
                m.angle += m.rotSpeed * delta;

                const wanderR = Math.sin(t * m.wanderFreqX + m.phaseX) * 0.20;
                const wanderY = Math.sin(t * m.wanderFreqY + m.phaseY) * 0.22;
                const curR = Math.max(0.08, m.baseR + wanderR);

                const flX = Math.sin(t * m.flutterFreq + i * 2.3) * m.flutterAmp;
                const flY = Math.cos(t * (m.flutterFreq * 1.15) + i * 3.1) * m.flutterAmp;
                const flZ = Math.sin(t * (m.flutterFreq * 0.85) + i * 1.7) * m.flutterAmp;

                const px = rx + curR * Math.cos(m.angle) + flX;
                const pz = rz + curR * Math.sin(m.angle) + flZ;
                const py = Math.max(0.60, Math.min(3.18, m.baseY + wanderY + flY));

                positions[i * 3] = px;
                positions[i * 3 + 1] = py;
                positions[i * 3 + 2] = pz;
            }

            geo.attributes.position.needsUpdate = true;
        }

        // â”€â”€ HELLGRAUER KOERNIGER LAGERHAUSBODEN (EINFACH GEHALTEN) â”€â”€
        function createGrainyWarehouseFloorTexture() {
            const canvas = document.createElement("canvas");
            canvas.width = 512;
            canvas.height = 512;
            const ctx = canvas.getContext("2d");

            // Hellgraue Grundierung
            ctx.fillStyle = "#d1d5db";
            ctx.fillRect(0, 0, 512, 512);

            // Feines mineralisches Korn / Rauschen
            const imgData = ctx.getImageData(0, 0, 512, 512);
            const data = imgData.data;
            for (let i = 0; i < data.length; i += 4) {
                const grain = (Math.random() - 0.5) * 38;
                data[i]     = Math.min(255, Math.max(0, data[i] + grain));
                data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + grain));
                data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + grain));
            }
            ctx.putImageData(imgData, 0, 0);

            // Vereinzelte zarte Sprenkel fuer authentischen Estrich
            ctx.fillStyle = "rgba(75, 85, 99, 0.18)";
            for (let s = 0; s < 450; s++) {
                const sx = Math.random() * 512;
                const sy = Math.random() * 512;
                const sr = Math.random() * 1.5 + 0.5;
                ctx.beginPath();
                ctx.arc(sx, sy, sr, 0, Math.PI * 2);
                ctx.fill();
            }

            const texture = new THREE.CanvasTexture(canvas);
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(8, 8);
            return texture;
        }

        function buildLagerRaum() {
            const rx = -15.692, rz = -5.099;
            const doorAngle = 0.3141593; // 18 Grad, zeigt frontal zum Hofzentrum

            // 1. Hellgrauer koerniger Lagerhausboden
            const floorGeo = new THREE.CircleGeometry(5.42, 48);
            const warehouseFloorTex = createGrainyWarehouseFloorTexture();
            const floorMat = new THREE.MeshStandardMaterial({
                map: warehouseFloorTex,
                roughness: 0.85,
                metalness: 0.05
            });
            const floor = new THREE.Mesh(floorGeo, floorMat);
            floor.rotation.x = -Math.PI / 2;
            floor.position.set(rx, 0.015, rz);
            scene.add(floor);

            // 2. EINZELNE ZENTRALE LAGER-LAMPE MIT LEUCHTENDEM LICHT
            const lampGroup = new THREE.Group();

            // Deckenkabel & Baldachin
            const cableGeo = new THREE.CylinderGeometry(0.006, 0.006, 1.25, 8);
            const cableMat = new THREE.MeshStandardMaterial({ color: 0x18181b, metalness: 0.8, roughness: 0.4 });
            const cable = new THREE.Mesh(cableGeo, cableMat);
            cable.position.set(0, 3.875, 0);
            lampGroup.add(cable);

            const canopy = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.04, 16), cableMat);
            canopy.position.set(0, 4.48, 0);
            lampGroup.add(canopy);

            const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.12, 16), cableMat);
            socket.position.set(0, 3.31, 0);
            lampGroup.add(socket);

            // Schwarzer Industrie-Reflektorschirm (Breiter Trichter)
            const shadeGeo = new THREE.CylinderGeometry(0.10, 0.46, 0.26, 24, 1, true);
            const shadeMatOuter = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.6, metalness: 0.4, side: THREE.FrontSide });
            const shadeMatInner = new THREE.MeshBasicMaterial({ color: 0xfef3c7, side: THREE.BackSide });
            const shadeOuter = new THREE.Mesh(shadeGeo, shadeMatOuter);
            shadeOuter.position.set(0, 3.22, 0);
            lampGroup.add(shadeOuter);
            const shadeInner = new THREE.Mesh(shadeGeo, shadeMatInner);
            shadeInner.position.set(0, 3.22, 0);
            lampGroup.add(shadeInner);

            // Warm leuchtende Gluehbirne
            const bulbGeo = new THREE.SphereGeometry(0.075, 16, 16);
            const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffedd5 });
            const bulb = new THREE.Mesh(bulbGeo, bulbMat);
            bulb.position.set(0, 3.15, 0);
            lampGroup.add(bulb);

            // Echte PointLight-Lichtquelle fuer realistische Raumausleuchtung
            const lampLight = new THREE.PointLight(0xffedd5, 2.4, 15, 1.2);
            lampLight.position.set(0, 3.12, 0);
            lampGroup.add(lampLight);

            lampGroup.position.set(rx, 0, rz);
            scene.add(lampGroup);

            // 3. VOLUMETRISCHER LICHTKEGEL DER LAGERLAMPE (WIE BEIM PROJEKTOR)
            const coneH = 3.12;
            const warehouseBeamGeo = new THREE.CylinderGeometry(0.38, 2.35, coneH, 32, 16, true);
            warehouseBeamGeo.translate(0, -coneH / 2, 0);

            const coneMat = new THREE.ShaderMaterial({
                uniforms: {
                    uColor: { value: new THREE.Color(0xfff7ed) },
                    uOpacity: { value: 0.28 }
                },
                vertexShader: [
                    'varying float vHeight;',
                    'varying vec3 vNormal;',
                    'varying vec3 vViewPos;',
                    'void main() {',
                    '    vHeight = position.y;',
                    '    vNormal = normalize(normalMatrix * normal);',
                    '    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);',
                    '    vViewPos = -mvPos.xyz;',
                    '    gl_Position = projectionMatrix * mvPos;',
                    '}'
                ].join('\n'),
                fragmentShader: [
                    'uniform vec3 uColor;',
                    'uniform float uOpacity;',
                    'varying float vHeight;',
                    'varying vec3 vNormal;',
                    'varying vec3 vViewPos;',
                    'void main() {',
                    '    float normY = clamp(-vHeight / 3.12, 0.0, 1.0);',
                    '    float floorFade = smoothstep(1.0, 0.76, normY);',
                    '    float vertFade = pow(1.0 - normY * 0.70, 1.3);',
                    '    vec3 n = normalize(vNormal);',
                    '    vec3 v = normalize(vViewPos);',
                    '    float rim = pow(1.0 - abs(dot(n, v)), 1.3) * 0.55 + 0.45;',
                    '    float alpha = uOpacity * floorFade * vertFade * rim;',
                    '    gl_FragColor = vec4(uColor, alpha);',
                    '}'
                ].join('\n'),
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide
            });

            warehouseLampBeamMesh = new THREE.Mesh(warehouseBeamGeo, coneMat);
            warehouseLampBeamMesh.position.set(rx, 3.15, rz);
            scene.add(warehouseLampBeamMesh);

            // Weicher warmer Leuchtfleck auf dem Betonboden
            const spotCanvas = document.createElement("canvas");
            spotCanvas.width = 256;
            spotCanvas.height = 256;
            const spCtx = spotCanvas.getContext("2d");
            const spGrad = spCtx.createRadialGradient(128, 128, 0, 128, 128, 126);
            spGrad.addColorStop(0, "rgba(254, 240, 138, 0.50)");
            spGrad.addColorStop(0.45, "rgba(253, 224, 71, 0.22)");
            spGrad.addColorStop(0.85, "rgba(250, 204, 21, 0.05)");
            spGrad.addColorStop(1, "rgba(250, 204, 21, 0.0)");
            spCtx.fillStyle = spGrad;
            spCtx.fillRect(0, 0, 256, 256);

            const spotTex = new THREE.CanvasTexture(spotCanvas);
            spotTex.colorSpace = THREE.SRGBColorSpace;
            const spotMat = new THREE.MeshBasicMaterial({
                map: spotTex,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const spotMesh = new THREE.Mesh(new THREE.CircleGeometry(2.30, 32), spotMat);
            spotMesh.rotation.x = -Math.PI / 2;
            spotMesh.position.set(rx, 0.022, rz);
            scene.add(spotMesh);

            // 4. MUECKEN IM LICHTKEGEL
            buildWarehouseMosquitoes(rx, rz);

            // â”€â”€ MASSIVER BETONKLOTZ MIT ROTEM AUFRAEUMEN-BUTTON AN DER WAND â”€â”€
            const plinthGroup = new THREE.Group();
            const plinthGeo = new THREE.BoxGeometry(0.80, 0.88, 0.80);
            const plinthMat = new THREE.MeshStandardMaterial({
                color: 0x64748b,
                roughness: 0.95,
                metalness: 0.05
            });
            const plinthMesh = new THREE.Mesh(plinthGeo, plinthMat);
            plinthMesh.position.y = 0.44;
            plinthGroup.add(plinthMesh);

            const rimGeo = new THREE.CylinderGeometry(0.20, 0.23, 0.04, 24);
            const rimMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.3, metalness: 0.8 });
            const rimMesh = new THREE.Mesh(rimGeo, rimMat);
            rimMesh.position.y = 0.88 + 0.02;
            plinthGroup.add(rimMesh);

            const btnGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.06, 24);
            const btnMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.3, emissive: 0x7f1d1d, emissiveIntensity: 0.4 });
            warehouseResetButtonMesh = new THREE.Mesh(btnGeo, btnMat);
            warehouseResetButtonMesh.position.y = 0.88 + 0.06;
            warehouseResetButtonMesh.userData = { isWarehouseResetButton: true };
            plinthGroup.add(warehouseResetButtonMesh);

            const signCanvas = document.createElement("canvas");
            signCanvas.width = 512;
            signCanvas.height = 160;
            const sCtx = signCanvas.getContext("2d");
            sCtx.fillStyle = "#0f172a";
            sCtx.fillRect(0, 0, 512, 160);
            sCtx.strokeStyle = "#eab308";
            sCtx.lineWidth = 12;
            sCtx.strokeRect(6, 6, 500, 148);
            sCtx.fillStyle = "#facc15";
            sCtx.font = 'bold 54px "Quicksand", sans-serif';
            sCtx.textAlign = "center";
            sCtx.textBaseline = "middle";
            sCtx.fillText("AUFRAEUMEN", 256, 80);

            const signTex = new THREE.CanvasTexture(signCanvas);
            signTex.colorSpace = THREE.SRGBColorSpace;
            const signMat = new THREE.MeshBasicMaterial({ map: signTex });
            const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.20), signMat);
            signMesh.position.set(0, 0.52, 0.405);
            plinthGroup.add(signMesh);

            const plinthAngle = doorAngle + Math.PI * 0.65;
            plinthGroup.position.set(rx + Math.cos(plinthAngle) * 3.8, 0, rz + Math.sin(plinthAngle) * 3.8);
            plinthGroup.rotation.y = plinthAngle + Math.PI;
            scene.add(plinthGroup);

            // â”€â”€ 12 VERSCHIEBBARE LAGER-STUEHLE (4 NORMALE BLAUE, 4 GELBE BARHOCKER, 4 ROTE SESSEL IM 2X2 MUSTER) â”€â”€
            buildWarehouseChairs(rx, rz, doorAngle);

            // â”€â”€ 4 JETPACKS IM LAGER (AUCH SYNCHRON DROPPBAR & MIT ORANGEN FLAMMEN) â”€â”€
            buildWarehouseJetpacks(rx, rz, doorAngle);
        }

        // 1. Normaler Stuhl in Sofablau (analog Chill-Area Couch)
        function createNormalChairMesh() {
            const chairGroup = new THREE.Group();

            const cushionBlueMat = new THREE.MeshLambertMaterial({ color: 0x1d4ed8 }); // Sofablau
            const darkBlueMat = new THREE.MeshLambertMaterial({ color: 0x1e3a8a });
            const legMat = new THREE.MeshLambertMaterial({ color: 0x18181b });

            // Sitzflaeche (Sitzpolster)
            const seatGeo = new THREE.BoxGeometry(0.48, 0.08, 0.46);
            const seatMesh = new THREE.Mesh(seatGeo, cushionBlueMat);
            seatMesh.position.y = 0.46;
            chairGroup.add(seatMesh);

            const seatUnder = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.04, 0.44), darkBlueMat);
            seatUnder.position.y = 0.41;
            chairGroup.add(seatUnder);

            // Rueckenlehne
            const backGeo = new THREE.BoxGeometry(0.46, 0.32, 0.06);
            const backMesh = new THREE.Mesh(backGeo, darkBlueMat);
            backMesh.position.set(0, 0.72, -0.20);
            chairGroup.add(backMesh);

            // Rueckenlehnen-Halterung
            [-0.14, 0.14].forEach(px => {
                const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.28, 12), legMat);
                post.position.set(px, 0.56, -0.20);
                chairGroup.add(post);
            });

            // 4 Beine
            [[-0.20, -0.19], [0.20, -0.19], [-0.20, 0.19], [0.20, 0.19]].forEach(([lx, lz]) => {
                const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.012, 0.45, 12), legMat);
                leg.position.set(lx, 0.225, lz);
                chairGroup.add(leg);
            });

            return { chairGroup, seatMesh, type: 'normal' };
        }

        // 2. Gelber Barhocker
        function createBarStoolMesh() {
            const chairGroup = new THREE.Group();

            const yellowMat = new THREE.MeshLambertMaterial({ color: 0xfacc15 }); // Gelb (wie Chillen Tisch)
            const darkMat = new THREE.MeshLambertMaterial({ color: 0x18181b });
            const chromeMat = new THREE.MeshLambertMaterial({ color: 0x71717a });

            // Runder gelber Sitzpolster
            const seatGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.08, 24);
            const seatMesh = new THREE.Mesh(seatGeo, yellowMat);
            seatMesh.position.y = 0.74;
            chairGroup.add(seatMesh);

            const seatPlate = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.03, 16), darkMat);
            seatPlate.position.y = 0.69;
            chairGroup.add(seatPlate);

            // Fussraste-Ring
            const footRing = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.012, 8, 24), chromeMat);
            footRing.rotation.x = Math.PI / 2;
            footRing.position.y = 0.28;
            chairGroup.add(footRing);

            // 4 hohe Beine (leicht ausgestellt)
            [[-0.14, -0.14], [0.14, -0.14], [-0.14, 0.14], [0.14, 0.14]].forEach(([lx, lz]) => {
                const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.011, 0.72, 12), darkMat);
                leg.position.set(lx, 0.35, lz);
                leg.rotation.z = -lx * 0.12;
                leg.rotation.x = lz * 0.12;
                chairGroup.add(leg);
            });

            return { chairGroup, seatMesh, type: 'barstool' };
        }

        // 3. Roter Sessel (Club-Sessel)
        function createRedArmchairMesh() {
            const chairGroup = new THREE.Group();

            const redMat = new THREE.MeshLambertMaterial({ color: 0xdc2626 }); // Kraeftiges Rot
            const darkRedMat = new THREE.MeshLambertMaterial({ color: 0x991b1b }); // Dunkleres Rot fuer Wangen
            const footMat = new THREE.MeshLambertMaterial({ color: 0x18181b });

            // Tiefes bequemes Sitzkissen
            const seatGeo = new THREE.BoxGeometry(0.58, 0.14, 0.54);
            const seatMesh = new THREE.Mesh(seatGeo, redMat);
            seatMesh.position.y = 0.38;
            chairGroup.add(seatMesh);

            const baseBox = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.16, 0.56), darkRedMat);
            baseBox.position.y = 0.22;
            chairGroup.add(baseBox);

            // Breite Rueckenlehne
            const backMesh = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.44, 0.14), darkRedMat);
            backMesh.position.set(0, 0.58, -0.22);
            chairGroup.add(backMesh);

            // Seiten-Armlehnen
            [-0.34, 0.34].forEach(ax => {
                const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.28, 0.56), darkRedMat);
                arm.position.set(ax, 0.44, 0);
                chairGroup.add(arm);
            });

            // 4 niedrige Fuesschen
            [[-0.26, -0.24], [0.26, -0.24], [-0.26, 0.24], [0.26, 0.24]].forEach(([fx, fz]) => {
                const foot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), footMat);
                foot.position.set(fx, 0.04, fz);
                chairGroup.add(foot);
            });

            return { chairGroup, seatMesh, type: 'sessel' };
        }

        function buildWarehouseChairs(rx, rz, doorAngle) {
            warehouseChairs = [];

            const groups = [
                {
                    type: 'normal',
                    creator: createNormalChairMesh,
                    title: 'Blauer Stuhl',
                    sitH: 1.15,
                    cx: -2.0,
                    cz: -2.0,
                    spacingX: 0.45,
                    spacingZ: 0.45
                },
                {
                    type: 'barstool',
                    creator: createBarStoolMesh,
                    title: 'Gelber Barhocker',
                    sitH: 1.40,
                    cx: -2.4,
                    cz: 1.4,
                    spacingX: 0.42,
                    spacingZ: 0.42
                },
                {
                    type: 'sessel',
                    creator: createRedArmchairMesh,
                    title: 'Roter Sessel',
                    sitH: 1.05,
                    cx: 2.0,
                    cz: -2.2,
                    spacingX: 0.55,
                    spacingZ: 0.55
                }
            ];

            groups.forEach((g) => {
                let idx = 0;
                [-g.spacingX, g.spacingX].forEach((dx) => {
                    [-g.spacingZ, g.spacingZ].forEach((dz) => {
                        const chairId = 'chair_' + g.type + '_' + idx;
                        const { chairGroup, seatMesh } = g.creator();

                        const defX = rx + g.cx + dx;
                        const defZ = rz + g.cz + dz;
                        const defRotY = Math.atan2(-g.cx - dx, -g.cz - dz);

                        chairGroup.position.set(defX, 0, defZ);
                        chairGroup.rotation.y = defRotY;
                        scene.add(chairGroup);

                        const sitPos = new THREE.Vector3(defX, g.sitH, defZ);
                        const lookDir = new THREE.Vector3(Math.sin(defRotY), 0, Math.cos(defRotY));
                        registerSeat(seatMesh, g.title + ' (Platz ' + (idx + 1) + ')', sitPos, lookDir);

                        seatMesh.userData.isMovableChair = true;
                        seatMesh.userData.chairId = chairId;

                        const chairObj = {
                            id: chairId,
                            type: g.type,
                            group: chairGroup,
                            seatMesh: seatMesh,
                            seat: seatMesh.userData.seat,
                            defaultPos: { x: Number(defX.toFixed(3)), z: Number(defZ.toFixed(3)), rotY: Number(defRotY.toFixed(3)) }
                        };
                        seatMesh.userData.chairObj = chairObj;
                        warehouseChairs.push(chairObj);
                        idx++;
                    });
                });
            });
        }

        // â”€â”€ TEXTUR: WARNUNG "Achtung! Jetpack!" FUER DAS MINIMALISTISCHE JETPACK â”€â”€
        function createJetpackWarningTexture() {
            const canvas = document.createElement("canvas");
            canvas.width = 512;
            canvas.height = 128;
            const ctx = canvas.getContext("2d");

            // Kraeftiger gelber Warn-Hintergrund
            ctx.fillStyle = "#facc15";
            ctx.fillRect(0, 0, 512, 128);

            // Schwarzer Aussenrahmen
            ctx.strokeStyle = "#000000";
            ctx.lineWidth = 10;
            ctx.strokeRect(5, 5, 502, 118);

            // Diagonale schwarze Warnstreifen links
            ctx.fillStyle = "#000000";
            for (let i = 0; i < 3; i++) {
                ctx.beginPath();
                ctx.moveTo(15 + i * 22, 10);
                ctx.lineTo(30 + i * 22, 10);
                ctx.lineTo(10 + i * 22, 118);
                ctx.lineTo(0 + i * 22, 118);
                ctx.closePath();
                ctx.fill();
            }

            // Diagonale schwarze Warnstreifen rechts
            for (let i = 0; i < 3; i++) {
                ctx.beginPath();
                ctx.moveTo(435 + i * 22, 10);
                ctx.lineTo(450 + i * 22, 10);
                ctx.lineTo(430 + i * 22, 118);
                ctx.lineTo(415 + i * 22, 118);
                ctx.closePath();
                ctx.fill();
            }

            // Text in der Mitte: "Achtung! Jetpack!"
            ctx.fillStyle = "#000000";
            ctx.font = '900 44px "Quicksand", sans-serif';
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("Achtung! Jetpack!", 256, 64);

            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            return texture;
        }

        // â”€â”€ KOMPLETT NEU DESIGNTES MINIMALISTISCHES JETPACK (OHNE STAENDER, STEHT DIREKT AM BODEN) â”€â”€
        function createRedesignedJetpackModel(opts = {}) {
            const jp = new THREE.Group();

            // Minimalistische Material-Palette: Mattes Anthrazit, gebuerstetes Titan, tiefes Schwarz & Warn-Badge
            const bodyMat = new THREE.MeshStandardMaterial({
                color: 0x27272a, // Mattes Anthrazit
                roughness: 0.85,
                metalness: 0.15
            });
            const tankMat = new THREE.MeshStandardMaterial({
                color: 0x52525b, // Gebuerstetes Titan / Dunkelgrau
                roughness: 0.45,
                metalness: 0.55
            });
            const nozzleMat = new THREE.MeshStandardMaterial({
                color: 0x18181b, // Tiefes Matt-Schwarz
                roughness: 0.35,
                metalness: 0.80
            });
            const strapMat = new THREE.MeshLambertMaterial({ color: 0x09090b });

            // 1. Schlanker, minimalistischer Unibody-Mittelblock
            // Laeuft von y = 0.08 bis y = 0.46 (Mitte y = 0.27)
            const mainBodyGeo = new THREE.BoxGeometry(0.28, 0.38, 0.08);
            const mainBody = new THREE.Mesh(mainBodyGeo, bodyMat);
            mainBody.position.set(0, 0.27, 0);
            jp.add(mainBody);

            // 2. Warn-Plakette: "Achtung! Jetpack!" auf der Rueckseite (-Z, im Raum frontal sichtbar)
            const warnTex = createJetpackWarningTexture();
            const badgeMat = new THREE.MeshBasicMaterial({ map: warnTex, side: THREE.FrontSide });
            const badgeGeo = new THREE.PlaneGeometry(0.24, 0.06);
            const badgeMesh = new THREE.Mesh(badgeGeo, badgeMat);
            badgeMesh.rotation.y = Math.PI; // Zeigt in -Z Richtung (frontal sichtbar)
            badgeMesh.position.set(0, 0.30, -0.041);
            jp.add(badgeMesh);

            // 3. Schlanke Zwillings-Drucktanks links und rechts
            const flameMeshes = [];

            const jetFlameOuterMat = new THREE.MeshBasicMaterial({
                color: 0xf97316,
                transparent: true,
                opacity: 0.88,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide
            });
            const jetFlameCoreMat = new THREE.MeshBasicMaterial({
                color: 0xfef08a,
                transparent: true,
                opacity: 0.95,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide
            });

            [-0.13, 0.13].forEach((tx) => {
                const thrusterGroup = new THREE.Group();
                thrusterGroup.position.set(tx, 0, 0);

                // Zylinder-Tank (y = 0.08 bis y = 0.46, Hoehe 0.38)
                const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.38, 20), tankMat);
                tank.position.y = 0.27;
                thrusterGroup.add(tank);

                // Halbkugelfoermige obere Kappe
                const cap = new THREE.Mesh(new THREE.SphereGeometry(0.048, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), tankMat);
                cap.position.y = 0.46;
                thrusterGroup.add(cap);

                // Konische Duese unten (y = 0.0 bis y = 0.08, Hoehe 0.08)
                // Die Duesenunterkante steht exakt bei y = 0.0 plan auf dem Boden!
                const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.034, 0.08, 18), nozzleMat);
                nozzle.position.y = 0.04;
                thrusterGroup.add(nozzle);

                // Flammenkegel (nur beim Fliegen sichtbar, unterhalb der Duese bei y <= 0.0)
                const outerFlame = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.08, 0.42, 16, 1, true), jetFlameOuterMat);
                outerFlame.position.set(0, -0.21, 0);
                thrusterGroup.add(outerFlame);

                const innerFlame = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.036, 0.28, 12, 1, true), jetFlameCoreMat);
                innerFlame.position.set(0, -0.14, 0);
                thrusterGroup.add(innerFlame);

                flameMeshes.push({ outer: outerFlame, inner: innerFlame });
                jp.add(thrusterGroup);
            });

            // 4. Schlichte Rueckengurte (auf der Trageseite +Z)
            [-0.07, 0.07].forEach(sx => {
                const strap = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.34, 0.012), strapMat);
                strap.position.set(sx, 0.27, 0.043);
                jp.add(strap);
            });

            // Unsichtbare Klick- und Raycast-Hitbox zum Aufheben mit [E]
            const hitBox = new THREE.Mesh(
                new THREE.BoxGeometry(0.44, 0.52, 0.22),
                new THREE.MeshBasicMaterial({ visible: false })
            );
            hitBox.position.set(0, 0.26, 0);
            hitBox.userData = { isJetpackItem: true, jetpackId: opts.id || 'jetpack' };
            jp.add(hitBox);

            flameMeshes.forEach(f => {
                f.outer.visible = false;
                f.inner.visible = false;
            });

            jp.userData = {
                hitBox: hitBox,
                id: opts.id || 'jetpack',
                flameMeshes: flameMeshes,
                setFlamesVisible: function(visible, scale = 1.0) {
                    flameMeshes.forEach(f => {
                        f.outer.visible = visible;
                        f.inner.visible = visible;
                        if (visible) {
                            f.outer.scale.set(1.0, scale, 1.0);
                            f.inner.scale.set(1.0, scale, 1.0);
                        }
                    });
                }
            };

            return jp;
        }

        function createWarehouseJetpackMesh(id) {
            return createRedesignedJetpackModel({ id: id });
        }

        function buildWarehouseJetpacks(rx, rz, doorAngle) {
            warehouseJetpacks = [];
            const jetpackOffsets = [-1.05, -0.35, 0.35, 1.05];

            for (let i = 0; i < 4; i++) {
                const id = 'jetpack_' + i;
                const jpGroup = createWarehouseJetpackMesh(id);

                const defX = rx + jetpackOffsets[i];
                const defY = 0.0;
                const defZ = rz + 3.10;
                const defRotY = 0; // Nach vorne in den Raum gerichtet

                jpGroup.position.set(defX, defY, defZ);
                jpGroup.rotation.y = defRotY;
                scene.add(jpGroup);

                const jpObj = {
                    id: id,
                    group: jpGroup,
                    hitBox: jpGroup.userData.hitBox,
                    defaultPos: { x: Number(defX.toFixed(3)), y: 0.0, z: Number(defZ.toFixed(3)), rotY: 0 },
                    isEquipped: false
                };
                jpGroup.userData.hitBox.userData.jetpackObj = jpObj;
                warehouseJetpacks.push(jpObj);
            }

            if (warehouseJetpacks.length > 0) {
                worldJetpackGroup = warehouseJetpacks[0].group;
            }
        }

        // â”€â”€ VERSCHIEBE-SYSTEM FUER DIE LAGERSTUEHLE (BLAUER RAHMEN & RICHTUNGSPFEIL) â”€â”€
        function startMovingChair(chairObj) {
            if (!chairObj || movingChairState || isSitting) return;

            const ghostGroup = new THREE.Group();

            const size = 0.68;
            const planeGeo = new THREE.PlaneGeometry(size, size);
            planeGeo.rotateX(-Math.PI / 2); // Flach auf den Boden gelegt

            // 1. Blauer 2D-Rahmen (analog Notiz-Vorschau)
            const edgesGeo = new THREE.EdgesGeometry(planeGeo);
            const lineMat = new THREE.LineBasicMaterial({
                color: 0x38bdf8,
                linewidth: 3,
                depthWrite: false
            });
            const frame = new THREE.LineSegments(edgesGeo, lineMat);
            frame.position.y = 0.02;
            ghostGroup.add(frame);

            // 2. Dezente transparente blaue FÃ¼llung
            const fillMat = new THREE.MeshBasicMaterial({
                color: 0x0284c7,
                transparent: true,
                opacity: 0.20,
                side: THREE.DoubleSide,
                depthWrite: false
            });
            const fillMesh = new THREE.Mesh(planeGeo, fillMat);
            fillMesh.position.y = 0.018;
            ghostGroup.add(fillMesh);

            // 3. Sauberer, flacher 2D-Richtungspfeil auf dem Boden in Blickrichtung (+Z)
            const arrowY = 0.022;
            const arrowGeo = new THREE.BufferGeometry();
            // Pfeilschaft (Breite 0.08m, Z von -0.16 bis +0.04) und Pfeilspitze (Breite 0.28m bei Z = 0.04, Spitze bei Z = 0.22)
            const arrowVerts = new Float32Array([
                // Schaft: Dreieck 1
                -0.04, arrowY, -0.16,
                -0.04, arrowY,  0.04,
                 0.04, arrowY,  0.04,
                // Schaft: Dreieck 2
                -0.04, arrowY, -0.16,
                 0.04, arrowY,  0.04,
                 0.04, arrowY, -0.16,
                // Pfeilspitze: Dreieck 3
                -0.14, arrowY,  0.04,
                 0.00, arrowY,  0.22,
                 0.14, arrowY,  0.04
            ]);
            arrowGeo.setAttribute('position', new THREE.BufferAttribute(arrowVerts, 3));
            arrowGeo.computeVertexNormals();

            const arrowMat = new THREE.MeshBasicMaterial({
                color: 0x38bdf8,
                side: THREE.DoubleSide,
                depthWrite: false
            });
            const arrowMesh = new THREE.Mesh(arrowGeo, arrowMat);
            ghostGroup.add(arrowMesh);

            // Zusaetzliche klare Konturlinie um die Pfeilsilhouette
            const arrowBorderPoints = [
                new THREE.Vector3(-0.04, arrowY + 0.001, -0.16),
                new THREE.Vector3( 0.04, arrowY + 0.001, -0.16),
                new THREE.Vector3( 0.04, arrowY + 0.001,  0.04),
                new THREE.Vector3( 0.14, arrowY + 0.001,  0.04),
                new THREE.Vector3( 0.00, arrowY + 0.001,  0.22),
                new THREE.Vector3(-0.14, arrowY + 0.001,  0.04),
                new THREE.Vector3(-0.04, arrowY + 0.001,  0.04),
                new THREE.Vector3(-0.04, arrowY + 0.001, -0.16)
            ];
            const arrowBorderGeo = new THREE.BufferGeometry().setFromPoints(arrowBorderPoints);
            const arrowBorderMat = new THREE.LineBasicMaterial({
                color: 0x7dd3fc,
                linewidth: 2,
                depthWrite: false
            });
            const arrowBorder = new THREE.Line(arrowBorderGeo, arrowBorderMat);
            ghostGroup.add(arrowBorder);

            // Fuer alle Ghost-Elemente Raycasting deaktivieren
            ghostGroup.traverse(c => {
                c.raycast = () => {};
            });

            ghostGroup.visible = false;
            scene.add(ghostGroup);

            chairObj.group.visible = false;

            movingChairState = {
                chairObj: chairObj,
                ghostGroup: ghostGroup,
                currentRotY: chairObj.group.rotation.y,
                rotOffset: 0,
                validTarget: null
            };

            currentInteractTarget = null;
            interactPrompt.textContent = "[E] oder [LMB] Abstellen\n[R] Drehen\n[ESC] Abbrechen";
            interactPrompt.classList.add("visible");
        }

        function rotateMovingChair(delta) {
            if (!movingChairState) return;
            movingChairState.rotOffset = ((movingChairState.rotOffset || 0) + delta) % (Math.PI * 2);
        }

        function placeMovingChair() {
            if (!movingChairState || !movingChairState.validTarget) return;
            const target = movingChairState.validTarget;
            const chairObj = movingChairState.chairObj;

            chairObj.group.position.set(target.x, 0, target.z);
            chairObj.group.rotation.y = target.rotY;
            chairObj.group.visible = true;

            if (chairObj.seat) {
                const sitH = chairObj.type === 'barstool' ? 1.40 : (chairObj.type === 'sessel' ? 1.05 : 1.15);
                chairObj.seat.sitPos.set(target.x, sitH, target.z);
                chairObj.seat.lookDir.set(Math.sin(target.rotY), 0, Math.cos(target.rotY));
            }

            const ghost = movingChairState.ghostGroup;
            if (ghost) {
                scene.remove(ghost);
                ghost.traverse(c => {
                    if (c.geometry) c.geometry.dispose();
                    if (c.material) c.material.dispose();
                });
            }
            movingChairState = null;
            interactPrompt.classList.remove("visible");

            try {
                const chairRef = rtdbRef(rtdb, "worldState/warehouseChairs/" + chairObj.id);
                rtdbSet(chairRef, {
                    x: Number(target.x.toFixed(3)),
                    z: Number(target.z.toFixed(3)),
                    rotY: Number(target.rotY.toFixed(3)),
                    updatedAt: Date.now()
                });
            } catch (err) {
                console.warn("RTDB chair sync error:", err);
            }
        }

        function cancelMovingChair() {
            if (!movingChairState) return;
            const chairObj = movingChairState.chairObj;
            if (chairObj && chairObj.group) {
                chairObj.group.visible = true;
            }
            const ghost = movingChairState.ghostGroup;
            if (ghost) {
                scene.remove(ghost);
                ghost.traverse(c => {
                    if (c.geometry) c.geometry.dispose();
                    if (c.material) c.material.dispose();
                });
            }
            movingChairState = null;
            interactPrompt.classList.remove("visible");
        }

        function triggerWarehouseReset() {
            if (isResettingChairs || !warehouseResetButtonMesh) return;
            isResettingChairs = true;

            warehouseResetButtonMesh.position.y -= 0.035;
            setTimeout(() => {
                if (warehouseResetButtonMesh) warehouseResetButtonMesh.position.y += 0.035;
                isResettingChairs = false;
            }, 180);

            const updatePayload = {};
            warehouseChairs.forEach(chairObj => {
                const def = chairObj.defaultPos;
                chairObj.group.position.set(def.x, 0, def.z);
                chairObj.group.rotation.y = def.rotY;
                chairObj.group.visible = true;
                if (chairObj.seat) {
                    const sitH = chairObj.type === 'barstool' ? 1.40 : (chairObj.type === 'sessel' ? 1.05 : 1.15);
                    chairObj.seat.sitPos.set(def.x, sitH, def.z);
                    chairObj.seat.lookDir.set(Math.sin(def.rotY), 0, Math.cos(def.rotY));
                }
                updatePayload[chairObj.id] = {
                    x: def.x,
                    z: def.z,
                    rotY: def.rotY,
                    updatedAt: Date.now()
                };
            });

            try {
                const allChairsRef = rtdbRef(rtdb, "worldState/warehouseChairs");
                rtdbSet(allChairsRef, updatePayload);
            } catch (err) {
                console.warn("RTDB reset chairs error:", err);
            }

            const jpPayload = {};
            warehouseJetpacks.forEach(jp => {
                const def = jp.defaultPos;
                if (!isJetpackEquipped || !currentEquippedJetpack || currentEquippedJetpack.id !== jp.id) {
                    jp.group.position.set(def.x, def.y || 0.05, def.z);
                    jp.group.rotation.y = def.rotY;
                    jp.group.visible = true;
                    jp.isEquipped = false;
                }
                jpPayload[jp.id] = {
                    isEquipped: false,
                    equippedBy: null,
                    x: def.x,
                    z: def.z,
                    rotY: def.rotY,
                    updatedAt: Date.now()
                };
            });

            try {
                const allJpRef = rtdbRef(rtdb, "worldState/warehouseJetpacks");
                rtdbSet(allJpRef, jpPayload);
            } catch (err) {
                console.warn("RTDB reset jetpacks error:", err);
            }

            interactPrompt.textContent = "Alle Stuehle und Jetpacks ins Lager aufgeraeumt!";
            interactPrompt.classList.add("visible");
            setTimeout(() => {
                if (interactPrompt.textContent === "Alle Stuehle ins Lager aufgeraeumt!") {
                    interactPrompt.classList.remove("visible");
                }
            }, 2500);
        }

        function syncWarehouseChairsFromNetwork(data) {
            if (!data || typeof data !== "object") return;
            warehouseChairs.forEach(chair => {
                if (movingChairState && movingChairState.chairObj.id === chair.id) return;
                const chairData = data[chair.id];
                if (chairData && typeof chairData.x === "number" && typeof chairData.z === "number") {
                    chair.group.position.set(chairData.x, 0, chairData.z);
                    chair.group.rotation.y = Number(chairData.rotY || 0);
                    chair.group.visible = true;
                    if (chair.seat) {
                        const sitH = chair.type === 'barstool' ? 1.40 : (chair.type === 'sessel' ? 1.05 : 1.15);
                        chair.seat.sitPos.set(chairData.x, sitH, chairData.z);
                        chair.seat.lookDir.set(Math.sin(chair.group.rotation.y), 0, Math.cos(chair.group.rotation.y));
                    }
                }
            });
        }





        // â”€â”€ REALISTISCHER HIMMEL: FLIESSENDE WOLKEN AM TAG & SPEKTAKULÃ„RER STERNENHIMMEL BEI NACHT â”€â”€
        function createRealisticProceduralSky() {
            skyUniforms = {
                uTime: { value: 0.0 },
                uNightTransition: { value: 0.0 },
                uSunPosition: { value: new THREE.Vector3(12.0, 35.0, 12.0).normalize() },
                uZenithColor: { value: new THREE.Color('#195cc7') },      // Strahlendes Tageslicht-Azurblau
                uHorizonColor: { value: new THREE.Color('#a8d3f8') },     // Weicher atmosphÃ¤rischer Dunst
                uGroundColor: { value: new THREE.Color('#0c141f') },      // Tiefer Horizontboden
                uSunColor: { value: new THREE.Color('#fff7ed') }          // Warmes Sonnenlicht
            };

            const vertexShader = `
                varying vec3 vViewDir;

                void main() {
                    vViewDir = normalize(position);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `;

            const fragmentShader = `
                precision highp float;

                uniform float uTime;
                uniform float uNightTransition;
                uniform vec3 uSunPosition;
                uniform vec3 uZenithColor;
                uniform vec3 uHorizonColor;
                uniform vec3 uGroundColor;
                uniform vec3 uSunColor;

                varying vec3 vViewDir;

                // Schnelles, stetiges Rauschen & Hash-Funktionen
                float hash(vec2 p) {
                    p = fract(p * vec2(123.34, 456.21));
                    p += dot(p, p + 45.32);
                    return fract(p.x * p.y);
                }

                float hash3(vec3 p) {
                    p = fract(p * vec3(123.34, 456.21, 789.12));
                    p += dot(p, p + 45.32);
                    return fract(p.x * p.y * p.z);
                }

                float noise(vec2 p) {
                    vec2 i = floor(p);
                    vec2 f = fract(p);
                    vec2 u = f * f * (3.0 - 2.0 * f);
                    return mix(
                        mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
                        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
                        u.y
                    );
                }

                const mat2 m2 = mat2(0.80, 0.60, -0.60, 0.80);

                // 3-Oktaven-FBM fÃ¼r lebendige Wolkenstrukturen
                float fbm3(vec2 p) {
                    float f = 0.550 * noise(p); p = m2 * p * 2.02;
                    f += 0.280 * noise(p); p = m2 * p * 2.03;
                    f += 0.140 * noise(p);
                    return f / 0.970;
                }

                float cloudDensity(vec2 p) {
                    vec2 warp = vec2(noise(p * 0.7), noise(p * 0.7 + vec2(4.3, 1.7)));
                    float n = fbm3(p + warp * 0.45);
                    return smoothstep(0.40, 0.70, n);
                }

                // â”€â”€ SPEKTAKULÃ„RE STERNENHIMMEL-KOMPONENTEN â”€â”€

                // Mehrstufiges Sternenfeld: Tausende Sterne, Spektralfarben, Funkeln & Diffraktionsspikes
                vec3 renderStarField(vec3 dir, float time) {
                    vec3 stars = vec3(0.0);

                    // 1. Feiner kosmischer Sternenstaub (Tiefe & Glanz)
                    vec3 pDust = dir * 180.0;
                    vec3 cellDust = floor(pDust);
                    float hDust = hash3(cellDust);
                    if (hDust > 0.982) {
                        float b = (hDust - 0.982) / 0.018;
                        stars += vec3(b * 0.45);
                    }

                    // 2. Markante Einzelsterne mit individuellem Funkeln
                    vec3 pStars = dir * 75.0;
                    vec3 cellStars = floor(pStars);
                    vec3 fractStars = fract(pStars) - 0.5;

                    float hStar = hash3(cellStars);
                    if (hStar > 0.938) {
                        vec3 starOffset = vec3(
                            hash(cellStars.xy + vec2(1.1, 2.3)) - 0.5,
                            hash(cellStars.yz + vec2(3.4, 4.5)) - 0.5,
                            hash(cellStars.zx + vec2(5.6, 6.7)) - 0.5
                        ) * 0.70;

                        vec3 d = fractStars - starOffset;
                        float dist = length(d);

                        // Sternfarben nach Spektralklassen (Blau-WeiÃŸ, Sonnengelb, Roter Riese)
                        vec3 col = vec3(0.92, 0.96, 1.00);
                        float colorHash = hash(cellStars.xz + 7.12);
                        if (colorHash < 0.28) {
                            col = vec3(0.68, 0.84, 1.00); // HeiÃŸer Azur-Stern
                        } else if (colorHash < 0.58) {
                            col = vec3(1.00, 0.94, 0.80); // Warmes Sonnengold
                        } else if (colorHash < 0.75) {
                            col = vec3(1.00, 0.62, 0.42); // RÃ¶tlicher Riesenstern
                        }

                        // Realistisches Funkeln (Szintillation)
                        float twinkle = 0.72 + 0.38 * sin(time * (4.5 + hStar * 14.0) + hStar * 62.8);

                        // Kern-Luminanz und sanfter Schein
                        float starCore = smoothstep(0.08, 0.005, dist);
                        float starGlow = exp(-dist * 18.0) * 0.50;

                        // 4-strahlige Diffraktionskreuze bei prominenten Hero-Sternen
                        float spikes = 0.0;
                        if (hStar > 0.984 && dist < 0.28) {
                            float crossDist = min(abs(d.x), abs(d.y));
                            spikes = exp(-crossDist * 65.0) * exp(-dist * 14.0) * 0.75;
                        }

                        stars += col * ((starCore + starGlow + spikes) * twinkle);
                    }

                    return stars;
                }

                // â”€â”€ DURCHGÃ„NGIGES, MAJESTÃ„TISCHES GALAXIENLICHTBAND (MILCHSTRASSE) â”€â”€
                vec3 renderMilkyWay(vec3 dir, float time) {
                    // Normalenvektor der galaktischen Ebene: Spannt sich als durchgÃ¤ngiger GroÃŸkreis Ã¼ber das Firmament
                    const vec3 galNorm = vec3(0.8256, 0.1812, -0.5437); // normalisiert
                    const vec3 galU    = vec3(0.5500, 0.0, 0.8351);     // Tangente im Horizont
                    const vec3 galV    = vec3(-0.1513, 0.9834, 0.0997); // Bitangente zum Zenit

                    float d = dot(dir, galNorm);

                    // Kontinuierliche Profile quer zum Band
                    float galProfile = exp(-d * d * 20.0); // Kernband
                    float galGlow    = exp(-d * d * 4.5);  // AtmosphÃ¤rischer Schein

                    if (galGlow < 0.004) return vec3(0.0);

                    // GroÃŸkreis-Winkelkoordinate phi entlang des Bandes: Garantiert 100 % nahtlose DurchgÃ¤ngigkeit [-PI, PI]
                    float uDot = dot(dir, galU);
                    float vDot = dot(dir, galV);
                    float phi = atan(vDot, uDot);

                    // Stetige 2D-Koordinaten entlang und quer zum Band
                    vec2 st = vec2(phi * 2.8, d * 8.5);

                    // Mehrschichtiges kosmisches Rauschen fÃ¼r Sternenwolken und Nebelfilamente
                    float dust = fbm3(st + vec2(1.7, 3.2));
                    float detail = noise(st * 2.6 + vec2(4.8, 1.9));

                    // DunkelbÃ¤nder (Great Rift): Realistische feine StaubbÃ¤nder, die das Band niemals unterbrechen
                    float riftNoise = noise(st * 1.6 + vec2(0.8, 1.4));
                    float rift = smoothstep(0.35, 0.70, riftNoise);
                    float riftMask = 1.0 - 0.28 * rift * galProfile; // Maximal 28 % DÃ¤mpfung, Band bleibt immer durchgÃ¤ngig!

                    // Farbpalette: Strahlend goldener Kern, tiefviolette H-Alpha-Nebel und blaugrÃ¼ne Reflexionsnebel
                    vec3 galCoreCol   = vec3(1.00, 0.90, 0.75); // Goldener Kern
                    vec3 galVioletCol = vec3(0.50, 0.22, 0.68); // Kosmisches Violett/Magenta
                    vec3 galTealCol   = vec3(0.18, 0.42, 0.65); // Kosmisches Cyan/Teal

                    vec3 nebulaCol = mix(galTealCol, galVioletCol, dust);
                    nebulaCol = mix(nebulaCol, galCoreCol, galProfile * 0.55);

                    // Solides durchgÃ¤ngiges LichtrÃ¼ckgrat + lebendige Staubmodulation
                    float solidSpine = galProfile * 0.68 + galGlow * 0.32;
                    float modulation = 0.72 + 0.35 * dust + 0.15 * detail;

                    float intensity = solidSpine * modulation * riftMask;
                    return nebulaCol * intensity;
                }

                // â”€â”€ FEINE, REALISTISCHE STERNSCHNUPPEN (OHNE GROSSE FEUERBÃ„LLE, NADELFEINE LINIEN) â”€â”€
                vec3 renderShootingStar(vec3 dir, float time) {
                    float seed = floor(time / 7.5);
                    float cycle = mod(time, 7.5);
                    // Ein schnelles, elegantes Aufleuchten fÃ¼r 0.60 Sekunden
                    if (cycle > 0.60) return vec3(0.0);

                    float t = cycle / 0.60; // 0.0 bis 1.0 wÃ¤hrend des Flugs

                    // ZufÃ¤llige Flugbahn im oberen Himmelsbereich pro Intervall
                    float h1 = hash(vec2(seed, 2.14));
                    float h2 = hash(vec2(seed, 5.37));
                    float h3 = hash(vec2(seed, 8.91));

                    vec3 startPos = normalize(vec3(
                        sin(h1 * 6.283) * 0.80,
                        0.65 + h2 * 0.28,
                        cos(h1 * 6.283) * 0.80
                    ));

                    vec3 streakDir = normalize(vec3(
                        cos(h3 * 6.283),
                        -0.35 - h2 * 0.20,
                        sin(h3 * 6.283)
                    ));

                    vec3 endPos = normalize(startPos + streakDir * 0.48);

                    // Meteor-Kopf
                    vec3 head = normalize(mix(startPos, endPos, t));

                    // Meteor-Schweif (zieht hinterher)
                    float tailLength = 0.18;
                    vec3 tail = normalize(mix(startPos, endPos, max(0.0, t - tailLength)));

                    // Exakte Projektion auf das Liniensegment [tail, head]
                    vec3 vSeg = head - tail;
                    float segLenSq = dot(vSeg, vSeg);
                    if (segLenSq < 0.00001) return vec3(0.0);

                    vec3 p = dir - tail;
                    float proj = clamp(dot(p, vSeg) / segLenSq, 0.0, 1.0);
                    vec3 closest = tail + vSeg * proj;
                    float dist = length(dir - closest);

                    // Nadelfeiner Schweif (nur ca. 1-2 Pixel dÃ¼nn, keine FeuerbÃ¤lle!)
                    float lineWidth = 0.0016;
                    float streak = smoothstep(lineWidth, 0.0, dist);

                    // Sanfte HelligkeitsverjÃ¼ngung vom Kopf zum Ende des Schweifs
                    float taper = pow(proj, 2.2);

                    // Diskreter, winziger Stecknadelkopf-Funke an der Spitze (kein Feuerball!)
                    float headSpark = exp(-length(dir - head) * 450.0) * 1.6;

                    // Ein- und Ausblenden wÃ¤hrend des Fluges
                    float flightFade = sin(t * 3.14159);

                    float intensity = (streak * taper * 2.4 + headSpark) * flightFade;
                    return vec3(0.96, 0.98, 1.00) * intensity;
                }

                void main() {
                    vec3 dir = normalize(vViewDir);
                    float t = clamp(uNightTransition, 0.0, 1.0);

                    // â”€â”€ 1. TAGESLICHT-HIMMEL MIT FLIESSENDEN WOLKEN â”€â”€
                    vec3 daySky = vec3(0.0);
                    if (t < 0.999) {
                        vec3 sunDir = normalize(uSunPosition);
                        float sunDot = max(dot(dir, sunDir), 0.0);

                        if (dir.y >= 0.0) {
                            float h = dir.y;
                            vec3 skyGradient = mix(uHorizonColor, uZenithColor, pow(h, 0.58));

                            float sunDisc = smoothstep(0.9986, 0.9996, sunDot);
                            float sunHalo = pow(sunDot, 128.0) * 0.20 + pow(sunDot, 32.0) * 0.08;
                            vec3 sunDiscCol = vec3(1.0, 0.98, 0.92);

                            daySky = mix(skyGradient, sunDiscCol, sunDisc * 0.90);
                            daySky += uSunColor * sunHalo;

                            if (dir.y > 0.01) {
                                float cloudHeight = 1.0 / (dir.y + 0.16);
                                vec2 windOffset = uTime * vec2(0.012, 0.006);
                                vec2 cloudUV = dir.xz * cloudHeight * 2.2 + windOffset;
                                vec2 sunCloudUV = sunDir.xz / (sunDir.y + 0.16) * 2.2 + windOffset;

                                float dens = cloudDensity(cloudUV);

                                float eps = 0.06;
                                float dX = cloudDensity(cloudUV + vec2(eps, 0.0));
                                float dY = cloudDensity(cloudUV + vec2(0.0, eps));
                                vec3 cloudNorm = normalize(vec3((dens - dX) * 3.5, 0.45, (dens - dY) * 3.5));

                                float sunDiff = clamp(dot(cloudNorm, sunDir), 0.0, 1.0);
                                float ambientUp = clamp(cloudNorm.y * 0.5 + 0.5, 0.0, 1.0);

                                float silverLining = pow(sunDot, 4.0) * smoothstep(0.02, 0.35, dens) * (1.0 - smoothstep(0.35, 0.85, dens));

                                vec3 cloudBaseCol = vec3(0.55, 0.62, 0.74);
                                vec3 cloudMidCol  = vec3(0.86, 0.91, 0.97);
                                vec3 cloudLitCol  = vec3(1.00, 1.00, 0.99);
                                vec3 silverCol    = vec3(1.00, 0.98, 0.92) * 0.60;

                                vec3 cloudShading = mix(cloudBaseCol, cloudMidCol, ambientUp);
                                cloudShading = mix(cloudShading, cloudLitCol, sunDiff * 0.82 + 0.18);
                                cloudShading += silverCol * silverLining;

                                vec2 toSun = sunCloudUV - cloudUV;
                                vec2 rayStep = normalize(toSun) * 0.15;
                                float rayTransmittance = (1.0 - cloudDensity(cloudUV + rayStep * 1.5)) +
                                                         (1.0 - cloudDensity(cloudUV + rayStep * 3.0));
                                rayTransmittance *= 0.5;

                                float rayAngle = atan(toSun.y, toSun.x);
                                float streak = noise(vec2(rayAngle * 7.0, uTime * 0.02)) * 0.5 + 0.5;
                                float angularGlow = pow(sunDot, 4.0) * 0.35 + pow(sunDot, 16.0) * 0.45;
                                float godRays = rayTransmittance * angularGlow * (0.6 + 0.4 * streak) * (1.0 - dens * 0.85);
                                vec3 godRayCol = vec3(1.0, 0.97, 0.90) * 0.35;

                                float horizonFade = smoothstep(0.01, 0.16, dir.y);
                                float cloudAlpha = dens * horizonFade;

                                daySky = mix(daySky, cloudShading, cloudAlpha);
                                daySky += godRayCol * (godRays * horizonFade);
                            }
                        } else {
                            float distHaze = exp(-abs(dir.y) * 14.0);
                            daySky = mix(uGroundColor, uHorizonColor, distHaze * 0.85);
                        }
                    }

                    // â”€â”€ 2. SPEKTAKULÃ„RER STERNENHIMMEL BEI NACHT â”€â”€
                    vec3 nightSky = vec3(0.0);
                    if (t > 0.001) {
                        if (dir.y >= -0.02) {
                            float h = max(dir.y, 0.0);
                            vec3 nightZenith  = vec3(0.008, 0.012, 0.030); // Tiefes Obsidian-Schwarz
                            vec3 nightHorizon = vec3(0.030, 0.050, 0.105); // Kosmisches Indigoblau
                            nightSky = mix(nightHorizon, nightZenith, pow(h, 0.65));

                            vec3 stars = renderStarField(dir, uTime);
                            vec3 milkyWay = renderMilkyWay(dir, uTime);
                            vec3 shootingStar = renderShootingStar(dir, uTime);

                            float horizonFade = smoothstep(-0.02, 0.14, dir.y);
                            nightSky += (stars + milkyWay + shootingStar) * horizonFade;
                        } else {
                            float distHaze = exp(-abs(dir.y) * 12.0);
                            nightSky = mix(vec3(0.004, 0.007, 0.014), vec3(0.018, 0.028, 0.065), distHaze);
                        }
                    }

                    // â”€â”€ 3. SANFTES, PERFEKTES CROSS-FADING ZWISCHEN TAG UND NACHT â”€â”€
                    vec3 finalColor = mix(daySky, nightSky, t);
                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `;

            const skyMaterial = new THREE.ShaderMaterial({
                uniforms: skyUniforms,
                vertexShader: vertexShader,
                fragmentShader: fragmentShader,
                side: THREE.BackSide,
                depthWrite: false,
                depthTest: false,
                fog: false
            });

            const skyGeom = new THREE.SphereGeometry(750, 48, 24);
            const dome = new THREE.Mesh(skyGeom, skyMaterial);
            dome.renderOrder = -99999;
            return dome;
        }


        // â”€â”€ ECHTE HALBKUGELFÃ–RMIGE GEODÃ„TISCHE KUPPEL (HALBKUGEL R = 24 m) â”€â”€
        const DOME_RADIUS = COURTYARD_RADIUS; // Exakt 24.0 m Radius fÃ¼r eine echte, perfekte Halbkugel
        const DOME_APEX_Y = WALL_HEIGHT + DOME_RADIUS; // Scheitelpunkt bei y = 29.0 m

        function getDomeHeightAt(r) {
            if (r >= COURTYARD_RADIUS) return WALL_HEIGHT;
            const term = DOME_RADIUS * DOME_RADIUS - r * r;
            if (term <= 0) return WALL_HEIGHT;
            return WALL_HEIGHT + Math.sqrt(term);
        }

        function getDomeCeilingY(x, z) {
            const r = Math.hypot(x, z);
            if (r >= COURTYARD_RADIUS) return WALL_HEIGHT - 0.4;
            const domeY = getDomeHeightAt(r);
            return Math.max(WALL_HEIGHT - 0.4, domeY - 0.6);
        }

        function createGeodesicGlassDome() {
            const domeGroup = new THREE.Group();

            const numRings = 8; // 8 HÃ¶henringe fÃ¼r vollkommen symmetrische, gerade Dreiecksproportionen
            const segments = 36; // 36 Radialteilungen (exakt passend zur 36-teiligen Hofwand)

            const vertices = [];
            const ringVertexIndices = [];

            // 1. StÃ¼tzpunkte entlang der echten Halbkugel
            for (let i = 0; i <= numRings; i++) {
                const phi = (i / numRings) * (Math.PI * 0.5); // 0 (senkrechte Basis) bis PI/2 (Scheitel)
                const r = DOME_RADIUS * Math.cos(phi);
                const y = WALL_HEIGHT + DOME_RADIUS * Math.sin(phi);

                const ring = [];
                if (i === numRings) {
                    // Scheitelpunkt der Halbkugel exakt bei y = 29.0 m
                    vertices.push({ x: 0, y: DOME_APEX_Y, z: 0 });
                    ring.push(vertices.length - 1);
                } else {
                    const angleOffset = (i % 2) * (Math.PI / segments);
                    for (let j = 0; j < segments; j++) {
                        const theta = j * (2 * Math.PI / segments) + angleOffset;
                        const x = r * Math.cos(theta);
                        const z = r * Math.sin(theta);
                        vertices.push({ x, y, z });
                        ring.push(vertices.length - 1);
                    }
                }
                ringVertexIndices.push(ring);
            }

            // 2. Mathematisch exakte, symmetrische GeodÃ¤ten-Triangulierung
            const edgesMap = new Map();

            function registerEdge(i1, i2) {
                const min = Math.min(i1, i2);
                const max = Math.max(i1, i2);
                const key = min + "_" + max;
                if (!edgesMap.has(key)) {
                    edgesMap.set(key, [min, max]);
                }
            }

            for (let i = 0; i < numRings; i++) {
                const rCurrent = ringVertexIndices[i];
                const rNext = ringVertexIndices[i + 1];

                if (i === numRings - 1) {
                    const apexIdx = rNext[0];
                    for (let j = 0; j < segments; j++) {
                        const p1 = rCurrent[j];
                        const p2 = rCurrent[(j + 1) % segments];
                        registerEdge(p1, p2);
                        registerEdge(p2, apexIdx);
                        registerEdge(apexIdx, p1);
                    }
                } else {
                    for (let j = 0; j < segments; j++) {
                        const c1 = rCurrent[j];
                        const c2 = rCurrent[(j + 1) % segments];
                        const n1 = rNext[j];
                        const n2 = rNext[(j + 1) % segments];

                        if (i % 2 === 0) {
                            // rCurrent hat Offset 0, rNext hat Offset +halfStep.
                            // n1 liegt exakt mittig Ã¼ber c1 und c2 -> perfekt symmetrisches, aufrechtes Dreieck!
                            registerEdge(c1, c2);
                            registerEdge(c2, n1);
                            registerEdge(n1, c1);
                            registerEdge(c2, n2);
                            registerEdge(n2, n1);
                        } else {
                            // rCurrent hat Offset +halfStep, rNext hat Offset 0.
                            // n2 liegt exakt mittig Ã¼ber c1 und c2 -> perfekt symmetrisches, aufrechtes Dreieck!
                            registerEdge(c1, c2);
                            registerEdge(c2, n2);
                            registerEdge(n2, c1);
                            registerEdge(n2, n1);
                            registerEdge(n1, c1);
                        }
                    }
                }
            }

            // 3. Dreidimensionale Titan-Profilstreben als offene, architektonische GeodÃ¤ten-Struktur (ohne verdeckenden Glaseffekt)
            const strutPositions = [];
            const strutNormals = [];
            const strutRadius = 0.045; // 9 cm breite Titan-Tragprofile

            function buildStrutPrism(p1, p2, radius, sides) {
                const dx = p2.x - p1.x, dy = p2.y - p1.y, dz = p2.z - p1.z;
                const len = Math.hypot(dx, dy, dz);
                if (len < 1e-4) return;
                const ux = dx / len, uy = dy / len, uz = dz / len;

                let vx, vy, vz;
                if (Math.abs(uy) < 0.9) {
                    vx = -uz; vy = 0; vz = ux;
                } else {
                    vx = 0; vy = uz; vz = -uy;
                }
                const vlen = Math.hypot(vx, vy, vz);
                vx /= vlen; vy /= vlen; vz /= vlen;

                const wx = uy * vz - uz * vy;
                const wy = uz * vx - ux * vz;
                const wz = ux * vy - uy * vx;

                for (let k = 0; k < sides; k++) {
                    const a1 = (k / sides) * Math.PI * 2;
                    const a2 = ((k + 1) / sides) * Math.PI * 2;

                    const c1 = Math.cos(a1) * radius, s1 = Math.sin(a1) * radius;
                    const c2 = Math.cos(a2) * radius, s2 = Math.sin(a2) * radius;

                    const r1x = c1 * vx + s1 * wx, r1y = c1 * vy + s1 * wy, r1z = c1 * vz + s1 * wz;
                    const r2x = c2 * vx + s2 * wx, r2y = c2 * vy + s2 * wy, r2z = c2 * vz + s2 * wz;

                    const midA = (a1 + a2) * 0.5;
                    const mc = Math.cos(midA), ms = Math.sin(midA);
                    const fnx = mc * vx + ms * wx, fny = mc * vy + ms * wy, fnz = mc * vz + ms * wz;

                    const a1x = p1.x + r1x, a1y = p1.y + r1y, a1z = p1.z + r1z;
                    const b1x = p2.x + r1x, b1y = p2.y + r1y, b1z = p2.z + r1z;
                    const a2x = p1.x + r2x, a2y = p1.y + r2y, a2z = p1.z + r2z;
                    const b2x = p2.x + r2x, b2y = p2.y + r2y, b2z = p2.z + r2z;

                    strutPositions.push(a1x, a1y, a1z,  b1x, b1y, b1z,  b2x, b2y, b2z);
                    strutNormals.push(fnx, fny, fnz,  fnx, fny, fnz,  fnx, fny, fnz);

                    strutPositions.push(a1x, a1y, a1z,  b2x, b2y, b2z,  a2x, a2y, a2z);
                    strutNormals.push(fnx, fny, fnz,  fnx, fny, fnz,  fnx, fny, fnz);
                }
            }

            edgesMap.forEach(([i1, i2]) => {
                buildStrutPrism(vertices[i1], vertices[i2], strutRadius, 4);
            });

            const frameGeo = new THREE.BufferGeometry();
            frameGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(strutPositions), 3));
            frameGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(strutNormals), 3));

            const frameMat = new THREE.MeshStandardMaterial({
                color: 0x1e293b, // Elegantes Anthrazit-Titan
                roughness: 0.28,
                metalness: 0.85
            });

            const frameMesh = new THREE.Mesh(frameGeo, frameMat);
            domeGroup.add(frameMesh);

            // 4. Massiver, bÃ¼ndiger Ringbalken auf der AuÃŸenwand (y = 5.0 m, r = 24.0 m)
            const ringBeamGeo = new THREE.TorusGeometry(COURTYARD_RADIUS, 0.14, 12, 64);
            ringBeamGeo.rotateX(Math.PI / 2);
            const ringBeam = new THREE.Mesh(ringBeamGeo, frameMat);
            ringBeam.position.set(0, WALL_HEIGHT, 0);
            domeGroup.add(ringBeam);

            // 5. Scheitel-Abschlussring am Zenit der Halbkugel
            const apexCrownGeo = new THREE.TorusGeometry(0.85, 0.08, 12, 32);
            apexCrownGeo.rotateX(Math.PI / 2);
            const apexCrown = new THREE.Mesh(apexCrownGeo, frameMat);
            apexCrown.position.set(0, DOME_APEX_Y, 0);
            domeGroup.add(apexCrown);

            return domeGroup;
        }

        // â”€â”€ 3D INIT â”€â”€
        function initThreeWorld() {
            if (scene) {
                onWindowResize();
                if (!animationFrameId) animate();
                return;
            }

            scene = new THREE.Scene();
            scene.background = null; // ErmÃ¶glicht Durchsicht auf die Himmelskuppel

            skyDomeMesh = createRealisticProceduralSky();
            scene.add(skyDomeMesh);

            camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
            camera.position.set(0, EYE_HEIGHT, 0); // Spawn im Zentrum

            renderer = new THREE.WebGLRenderer({ canvas: gameCanvas, antialias: true, powerPreference: "high-performance" });
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

            // CSS3D Renderer fÃ¼r echten Video-Screen an der 3D-Wand
            cssScene = new THREE.Scene();
            cssRenderer = new CSS3DRenderer();
            cssRenderer.setSize(window.innerWidth, window.innerHeight);
            cssRenderer.domElement.style.position = 'absolute';
            cssRenderer.domElement.style.top = '0';
            cssRenderer.domElement.style.left = '0';
            cssRenderer.domElement.style.width = '100%';
            cssRenderer.domElement.style.height = '100%';
            cssRenderer.domElement.style.pointerEvents = 'none';
            cssRenderer.domElement.style.zIndex = '2';
            gameContainer.appendChild(cssRenderer.domElement);

            controls = new PointerLockControls(camera, document.body);

            // First-Person Fahrrad-Cockpit (am unteren Sichtrand bei Fahrt eingeblendet)
            localBikeCockpit = new THREE.Group();
            const rubberMat = new THREE.MeshLambertMaterial({ color: 0x18181b });
            const chromeMat = new THREE.MeshLambertMaterial({ color: 0xcbd5e1 });

            // Querlenker
            const cBar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.52, 12), chromeMat);
            cBar.rotation.z = Math.PI / 2;
            cBar.position.set(0, -0.28, -0.55);
            localBikeCockpit.add(cBar);

            // Griffe & Bremshebel
            [-0.24, 0.24].forEach(gx => {
                const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.09, 10), rubberMat);
                grip.rotation.z = Math.PI / 2;
                grip.position.set(gx, -0.28, -0.55);
                localBikeCockpit.add(grip);

                const lever = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.008, 0.08), chromeMat);
                lever.position.set(gx * 0.85, -0.29, -0.58);
                lever.rotation.y = gx > 0 ? -0.2 : 0.2;
                localBikeCockpit.add(lever);
            });

            // Vorbau & Steuerrohr
            const cStem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.16, 8), chromeMat);
            cStem.position.set(0, -0.35, -0.56);
            cStem.rotation.x = -0.35;
            localBikeCockpit.add(cStem);

            // Sichtbarer oberer Vorderrad-Reifenbogen in YZ-Ebene (Fahrtrichtung nach vorn)
            const cTire = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.035, 10, 24, Math.PI * 0.5), rubberMat);
            cTire.rotation.y = Math.PI / 2;
            cTire.position.set(0, -0.58, -0.42);
            localBikeCockpit.add(cTire);

            localBikeCockpit.visible = false;
            camera.add(localBikeCockpit);

        // â”€â”€ LOKALER SPIELER-AVATAR FUER 3RD-PERSON-MODUS â”€â”€
        function createLocalPlayerModel(color, nickname) {
            if (localPlayerGroup) {
                scene.remove(localPlayerGroup);
            }
            const group = new THREE.Group();

            const shoeMat = new THREE.MeshLambertMaterial({ color: 0x18181b });
            const shoeLeft = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.24), shoeMat);
            shoeLeft.position.set(-0.12, 0.06, -0.02);
            group.add(shoeLeft);

            const shoeRight = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.24), shoeMat);
            shoeRight.position.set(0.12, 0.06, -0.02);
            group.add(shoeRight);

            const legMat = new THREE.MeshLambertMaterial({ color: 0x27272a });
            const legLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.60, 12), legMat);
            legLeft.position.set(-0.12, 0.40, 0);
            group.add(legLeft);

            const legRight = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.60, 12), legMat);
            legRight.position.set(0.12, 0.40, 0);
            group.add(legRight);

            const bodyMat = new THREE.MeshLambertMaterial({ color: color });
            const torsoGeo = new THREE.CylinderGeometry(0.24, 0.22, 0.65, 16);
            const torso = new THREE.Mesh(torsoGeo, bodyMat);
            torso.position.y = 1.05;
            group.add(torso);

            const shoulderGeo = new THREE.SphereGeometry(0.24, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
            const shoulders = new THREE.Mesh(shoulderGeo, bodyMat);
            shoulders.position.y = 1.375;
            group.add(shoulders);

            const neckGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.10, 12);
            const neckMat = new THREE.MeshLambertMaterial({ color: 0x27272a });
            const neck = new THREE.Mesh(neckGeo, neckMat);
            neck.position.y = 1.48;
            group.add(neck);

            // Kopf exakt auf AugenhÃ¶he y = 1.70
            const headGeo = new THREE.SphereGeometry(0.20, 16, 16);
            const headMat = new THREE.MeshLambertMaterial({ color: color });
            const head = new THREE.Mesh(headGeo, headMat);
            head.position.y = 1.70;
            group.add(head);

            // Visier / Augen
            const visorGeo = new THREE.BoxGeometry(0.20, 0.07, 0.10);
            const visorMat = new THREE.MeshBasicMaterial({ color: 0x09090b });
            const visor = new THREE.Mesh(visorGeo, visorMat);
            visor.position.set(0, 1.70, -0.17);
            group.add(visor);

            // Nametag ueber Kopf
            const nameTag = createNameTagSprite(nickname, color);
            nameTag.position.set(0, 2.15, 0);
            group.add(nameTag);

            // Ausgeruestetes High-Tech Jetpack auf dem Ruecken
            localPlayerJetpack = createRedesignedJetpackModel({ id: 'local_equipped' });
            localPlayerJetpack.rotation.y = Math.PI;
            localPlayerJetpack.position.set(0, 0.85, 0.16);
            localPlayerJetpack.visible = isJetpackEquipped;
            group.add(localPlayerJetpack);

            // Eigene Spielfigur blockiert niemals Raycasts / Klicks
            group.traverse(c => {
                c.raycast = () => {};
            });

            group.visible = isThirdPersonMode;
            scene.add(group);
            localPlayerGroup = group;
            return group;
        }

        // â”€â”€ FIRST-PERSON: KEINE STOERENDEN MESHS VOR DER KAMERA â”€â”€
            localJetpackCockpit = null;
            localJetpackFlames = null;
            localJetpackLight = null;

            scene.add(camera);

            // Klick direkt in Spiel-Leinwand aktiviert die Steuerung (ohne Willkommens-Fenster!)
            gameCanvas.addEventListener("click", () => {
                if (!isModalOpen && controls && !controls.isLocked) {
                    if (cssRenderer && cssRenderer.domElement) cssRenderer.domElement.style.pointerEvents = 'none';
                    controls.lock();
                    footstepAudio.init();
                }
            });

            gameContainer.addEventListener("click", (e) => {
                if (!isModalOpen && controls && !controls.isLocked && !e.target.closest(".top-nav") && !e.target.closest(".modal-backdrop")) {
                    controls.lock();
                    footstepAudio.init();
                }
            });

            // Licht (dynamisch angepasst bei Tag- und Nacht-/Sternenhimmel)
            sceneAmbientLight = new THREE.AmbientLight(0xffffff, 0.7);
            sceneDirLight = new THREE.DirectionalLight(0xfff1e0, 0.6);
            const chillenRad = (54 * Math.PI) / 180;
            const lx = Math.cos(chillenRad) * 40;
            const lz = Math.sin(chillenRad) * 40;
            sceneDirLight.position.set(lx, 35, lz);
            scene.add(sceneDirLight);
            scene.add(sceneAmbientLight);



            // 1. Runder Hof-Boden (Radius 24 m): PBR Terrazzo-Fliesen (Tiles109)
            const courtyardFloorGeo = new THREE.CircleGeometry(COURTYARD_RADIUS + 0.2, 64);
            courtyardFloorGeo.attributes.uv2 = courtyardFloorGeo.attributes.uv;
            const courtyardFloorMat = tiles109CourtyardFloorMat;
            const courtyardFloor = new THREE.Mesh(courtyardFloorGeo, courtyardFloorMat);
            courtyardFloor.rotation.x = -Math.PI / 2;
            courtyardFloor.position.y = 0;
            courtyardFloor.receiveShadow = true;
            scene.add(courtyardFloor);

            // Konzentrische weiÃŸe Kreise um den mittleren Kreis (Abstand vergrÃ¶ÃŸert bis zum Rand)
            const concentricRingsCount = 9;
            const innerR = 2.06;
            const outerR = 23.6;
            const ringStep = (outerR - innerR) / concentricRingsCount;
            for (let i = 1; i <= concentricRingsCount; i++) {
                const r = innerR + i * ringStep;
                const t = (i - 1) / (concentricRingsCount - 1);
                const opacity = 0.52 * Math.pow(1 - t, 1.4) + 0.06;
                const ringGeo = new THREE.RingGeometry(r - 0.016, r + 0.016, 128);
                const ringMat = new THREE.MeshBasicMaterial({
                    color: 0xffffff,
                    transparent: true,
                    opacity: opacity,
                    side: THREE.DoubleSide,
                    depthWrite: false
                });
                const ring = new THREE.Mesh(ringGeo, ringMat);
                ring.rotation.x = -Math.PI / 2;
                ring.position.y = 0.003;
                scene.add(ring);
            }

            // 2. Runder Spawn-Bereich mit MANSION-Rundschrift
            const curvedSpawn = createCurvedSpawnMesh();
            scene.add(curvedSpawn);

            // 3. Hof-Außenwand (Radius 24)
            const outerWallGeo = new THREE.CylinderGeometry(COURTYARD_RADIUS, COURTYARD_RADIUS, WALL_HEIGHT, 64, 1, true);
            const outerWallMat = plasterCourtyardWallMat;
            const outerWall = new THREE.Mesh(outerWallGeo, outerWallMat);
            outerWall.position.set(0, WALL_HEIGHT / 2, 0);
            outerWall.userData = { isOuterWall: true };
            scene.add(outerWall);
            wallMeshes.push(outerWall);

            // DomfÃ¶rmige Glaskuppel aus dreieckigen, eingerahmten Glaspolygonen bÃ¼ndig auf AuÃŸenwand
            const glassDome = createGeodesicGlassDome();
            scene.add(glassDome);

            // 4. Die 5 Satellitenraeume
            SATELLITE_ROOMS.forEach((room) => {
                createCircularRoomWall(room);
            });

            buildArbeitsraum();
            buildChillenRaum();
            buildGamingRaum();
            buildArtRaum();
            buildLagerRaum();

            // Lokalen 3D-Avatar erzeugen & Kamera initialisieren
            const myColor = currentUser ? getPlayerColor(currentUser.uid) : "#3b82f6";
            createLocalPlayerModel(myColor, getStoredNickname());
            setCameraMode(isThirdPersonMode);

            raycaster = new THREE.Raycaster();
            raycaster.far = 4.5;

            window.addEventListener("resize", onWindowResize);
            document.addEventListener("keydown", onKeyDown);
            document.addEventListener("keyup", onKeyUp);

            // Mousedown im First-Person-Modus unterbindet Textselektions-Ziehgesten
            // Verhindert native Browser-Textselektion im Dokument (auÃŸer in echten Eingabefeldern)
            document.addEventListener("selectstart", (e) => {
                if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) {
                    return;
                }
                e.preventDefault();
            });

            document.addEventListener("mousedown", (e) => {
                if (controls && controls.isLocked) {
                    e.preventDefault();
                }
            });

            // Linksklick (LMB) Interaktion
            document.addEventListener("click", (e) => {
                if (e.button !== 0) return;
                if (isModalOpen || document.querySelector('.modal-backdrop.visible')) return;
                if (!controls || !controls.isLocked) return;

                if (isSitting) {
                    e.preventDefault();
                    standUp();
                    return;
                }

                if (movingChairState) {
                    if (movingChairState.validTarget) {
                        e.preventDefault();
                        placeMovingChair();
                    }
                    return;
                }

                if (movingNoteState) {
                    if (movingNoteState.validTarget) {
                        e.preventDefault();
                        pinMovingNote();
                    }
                    return;
                }

                if (!currentInteractTarget) return;

                e.preventDefault();
                e.stopPropagation();

                if (window.getSelection) {
                    window.getSelection().removeAllRanges();
                }

                if (currentInteractTarget.type === 'movableChair') {
                    sitDown(currentInteractTarget.seat);
                } else if (currentInteractTarget.type === 'warehouseResetButton') {
                    triggerWarehouseReset();
                } else if (currentInteractTarget.type === 'cinemaControl') {
                    handleCinemaControlClick(currentInteractTarget.action, currentInteractTarget.seekTime, currentInteractTarget.mesh);
                } else if (currentInteractTarget.type === 'cinema') {
                    handleCinemaScreenClick();
                } else if (currentInteractTarget.type === 'chillenLamp') {
                    toggleChillenLamp();
                } else if (currentInteractTarget.type === 'note') {
                    openViewNoteModal(currentInteractTarget.noteId, currentInteractTarget.data);
                } else if (currentInteractTarget.type === 'seat') {
                    sitDown(currentInteractTarget.seat);
                } else if (currentInteractTarget.type === 'bike') {
                    mountBike();
                } else if (currentInteractTarget.type === 'jetpack') {
                    equipJetpack(currentInteractTarget.jetpackObj);
                } else if (currentInteractTarget.type === 'pinboard') {
                    openNoteModal(currentInteractTarget.hit);
                } else if (currentInteractTarget.type === 'artWall') {
                    openArtModal(currentInteractTarget.hit);
                }
            });

            // â”€â”€ GPU PIPELINE WARMUP & PRE-COMPILATION GEGEN INITIALES RUCKELN â”€â”€
            try {
                renderer.compile(scene, camera);
                const savedRotY = camera.rotation.y;
                for (let a = 0; a < 4; a++) {
                    camera.rotation.y = a * (Math.PI / 2);
                    camera.updateMatrixWorld(true);
                    renderer.render(scene, camera);
                }
                camera.rotation.y = savedRotY;
                camera.updateMatrixWorld(true);
            } catch (warmupErr) {
                console.warn("GPU warmup note:", warmupErr);
            }

            clock.start();
            animate();

            // â”€â”€ CINEMA MODAL BUTTON-EREIGNISSE â”€â”€
            const btnPlay = document.getElementById('btn-cinema-play');
            if (btnPlay) {
                btnPlay.addEventListener('click', () => {
                    const raw = (document.getElementById('cinema-url-input').value || '').trim();
                    const vid = parseYouTubeId(raw);
                    if (!vid) {
                        const el = document.getElementById('cinema-status');
                        if (el) el.textContent = 'UngÃ¼ltige YouTube-URL oder Video-ID.';
                        return;
                    }
                    pushCinemaState(vid, true, 0);
                });
            }

            const btnPause = document.getElementById('btn-cinema-pause');
            if (btnPause) {
                btnPause.addEventListener('click', () => {
                    if (!currentCinemaVideoId) return;
                    let currentPos = currentCinemaSeekSec;
                    if (currentCinemaPlaying && currentCinemaStartedAt > 0) {
                        currentPos += Math.max(0, (Date.now() - currentCinemaStartedAt) / 1000);
                    }
                    const nextPlaying = !currentCinemaPlaying;
                    pushCinemaState(currentCinemaVideoId, nextPlaying, currentPos);
                });
            }

            const btnStop = document.getElementById('btn-cinema-stop');
            if (btnStop) {
                btnStop.addEventListener('click', () => {
                    pushCinemaState(null, false, 0);
                    document.getElementById('cinema-url-input').value = '';
                });
            }

            const btnCloseCinema = document.getElementById('btn-cinema-close');
            if (btnCloseCinema) {
                btnCloseCinema.addEventListener('click', closeCinemaModal);
            }

            const cinemaModalEl = document.getElementById('cinema-modal');
            if (cinemaModalEl) {
                cinemaModalEl.addEventListener('click', (e) => {
                    if (e.target === cinemaModalEl) closeCinemaModal();
                });
            }


        }

        function onWindowResize() {
            if (!camera || !renderer) return;
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
            if (cssRenderer) {
                cssRenderer.setSize(window.innerWidth, window.innerHeight);
            }
        }

        // Tastatur- und Maussteuerung
        function onKeyDown(e) {
            if (isModalOpen) {
                if (e.key === "Escape") {
                    closeModal();
                    closeArtModal();
                    closeViewNoteModal();
                    closeSettingsModal();
                    closeCinemaQuickModal();
                }
                return;
            }

            if (e.code === "Escape") {
                if (movingChairState) {
                    cancelMovingChair();
                    return;
                }
                if (movingNoteState) {
                    cancelMovingNote();
                    return;
                }
                if (isRidingBike) {
                    dismountBike();
                    return;
                }
            }

            if (isSitting) {
                if (e.code === "KeyE" || e.code === "Space" || 
                    e.code === "KeyW" || e.code === "KeyS" || 
                    e.code === "KeyA" || e.code === "KeyD" ||
                    e.code.startsWith("Arrow")) {
                    standUp();
                    return;
                }
            }

            switch (e.code) {
                case "KeyW":
                case "ArrowUp":
                    moveState.forward = true;
                    break;
                case "KeyS":
                case "ArrowDown":
                    moveState.backward = true;
                    break;
                case "KeyA":
                case "ArrowLeft":
                    moveState.left = true;
                    break;
                case "KeyD":
                case "ArrowRight":
                    moveState.right = true;
                    break;
                case "Space":
                    spacePressed = true;
                    if (!isJetpackEquipped) {
                        if (isOnGround) {
                            velocityY = JUMP_STRENGTH;
                            isOnGround = false;
                        }
                    }
                    break;

                case "KeyR":
                    if (movingChairState) {
                        rotateMovingChair(Math.PI / 4);
                    }
                    break;

                case "KeyV":
                    if (!isModalOpen && controls && controls.isLocked) {
                        setCameraMode(!isThirdPersonMode);
                        interactPrompt.textContent = isThirdPersonMode ? "Kamera: 3rd Person (Verfolger)" : "Kamera: 1st Person (Ego)";
                        interactPrompt.classList.add("visible");
                        clearTimeout(window._camPromptTimeout);
                        window._camPromptTimeout = setTimeout(() => {
                            if (!movingChairState && !movingNoteState) {
                                interactPrompt.classList.remove("visible");
                            }
                        }, 1500);
                    }
                    break;
                case "KeyE":
                    if (movingChairState) {
                        placeMovingChair();
                        return;
                    }
                    if (movingNoteState) {
                        pinMovingNote();
                        return;
                    }
                    if (isRidingBike) {
                        dismountBike();
                        return;
                    }
                    if (currentInteractTarget) {
                        if (currentInteractTarget.type === 'movableChair') {
                            startMovingChair(currentInteractTarget.chair);
                        } else if (currentInteractTarget.type === 'warehouseResetButton') {
                            triggerWarehouseReset();
                        } else if (currentInteractTarget.type === 'cinemaControl') {
                            handleCinemaControlClick(currentInteractTarget.action, currentInteractTarget.seekTime, currentInteractTarget.mesh);
                        } else if (currentInteractTarget.type === 'cinema') {
                            handleCinemaScreenClick();
                        } else if (currentInteractTarget.type === 'chillenLamp') {
                            toggleChillenLamp();
                        } else if (currentInteractTarget.type === 'note') {
                            startMovingNote();
                        } else if (currentInteractTarget.type === 'seat') {
                            // Sitzen ist ab jetzt ausschliesslich LMB (Linksklick)
                        } else if (currentInteractTarget.type === 'bike') {
                            mountBike();
                        } else if (currentInteractTarget.type === 'jetpack') {
                            equipJetpack(currentInteractTarget.jetpackObj);
                        } else if (currentInteractTarget.type === 'pinboard') {
                            openNoteModal(currentInteractTarget.hit);
                        } else if (currentInteractTarget.type === 'artWall') {
                            openArtModal(currentInteractTarget.hit);
                        }
                    } else if (isJetpackEquipped) {
                        dropJetpack();
                    }
                    break;
            }
        }

        function onKeyUp(e) {
            switch (e.code) {
                case "KeyW":
                case "ArrowUp":
                    moveState.forward = false;
                    break;
                case "KeyS":
                case "ArrowDown":
                    moveState.backward = false;
                    break;
                case "KeyA":
                case "ArrowLeft":
                    moveState.left = false;
                    break;
                case "KeyD":
                case "ArrowRight":
                    moveState.right = false;
                    break;
                case "Space":
                    spacePressed = false;
                    break;
            }
        }



        function animate() {
            animationFrameId = requestAnimationFrame(animate);

            const delta = Math.min(clock.getDelta(), 0.05);

            // Realistischer Himmel & Sternenhimmel: Zeit & sanftes Ãœberblenden fortfÃ¼hren
            if (skyUniforms) {
                skyUniforms.uTime.value += delta;
                nightTransition = THREE.MathUtils.damp(nightTransition, targetNightTransition, 2.2, delta);
                skyUniforms.uNightTransition.value = nightTransition;
            }
            if (skyDomeMesh && camera) {
                skyDomeMesh.position.copy(camera.position);
            }

            // AtmosphÃ¤rische Beleuchtungsanpassung bei Sternenhimmel
            if (sceneAmbientLight) {
                sceneAmbientLight.intensity = THREE.MathUtils.lerp(0.7, 0.28, nightTransition);
                sceneAmbientLight.color.lerpColors(new THREE.Color(0xffffff), new THREE.Color(0x8fa8d1), nightTransition);
            }
            if (sceneDirLight) {
                sceneDirLight.intensity = THREE.MathUtils.lerp(0.6, 0.08, nightTransition);
                sceneDirLight.color.lerpColors(new THREE.Color(0xfff1e0), new THREE.Color(0x9cbde6), nightTransition);
            }

            // â”€â”€ MULTIPLAYER FIX: LIVE-BEWEGUNGEN ALLER MITSPIELER LERPEN & POSITIONIEREN â”€â”€
            if (remotePlayersMap && remotePlayersMap.size > 0) {
                const pLerp = Math.min(1.0, delta * 14.0);
                remotePlayersMap.forEach((player) => {
                    if (!player || !player.mesh) return;

                    // Bei Teleport/Spawn sofort setzen, sonst weich interpolieren
                    if (player.mesh.position.distanceTo(player.targetPos) > 8.0) {
                        player.mesh.position.copy(player.targetPos);
                    } else {
                        player.mesh.position.lerp(player.targetPos, pLerp);
                    }

                    // KÃ¼rzeste Winkeldifferenz fÃ¼r weiche Y-Drehung
                    let rotDiff = player.targetRotY - player.mesh.rotation.y;
                    while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
                    while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
                    player.mesh.rotation.y += rotDiff * pLerp;
                });
            }

            if (artSculpture) {
                artSculpture.rotation.x += delta * 0.45;
                artSculpture.rotation.y += delta * 0.65;
            }

            let isMoving = false;

            if (controls && controls.isLocked) {
                if (!isSitting) {
                    // Jetpack Flug-Physik mit Schub via Leertaste
                    if (isJetpackEquipped && spacePressed) {
                        isJetpackThrusting = true;
                        isOnGround = false;
                        velocityY += (38.0 + GRAVITY) * delta;
                        if (velocityY > 7.0) velocityY = 7.0;
                        playerPos.y += velocityY * delta;

                        const domeCeilY = getDomeCeilingY(playerPos.x, playerPos.z);
                        if (playerPos.y >= domeCeilY) {
                            playerPos.y = domeCeilY;
                            velocityY = 0;
                        }

                        jetpackAudio.setThrust(true);
                    } else {
                        if (isJetpackThrusting) {
                            isJetpackThrusting = false;
                            jetpackAudio.setThrust(false);
                        }
                    }

                    // Flammen am lokalen Jetpack (3rd Person) und Cockpit (1st Person)
                    if (isJetpackEquipped) {
                        const flick = 0.85 + Math.random() * 0.35;
                        if (localPlayerJetpack && localPlayerJetpack.userData.setFlamesVisible) {
                            localPlayerJetpack.userData.setFlamesVisible(isJetpackThrusting, flick);
                        }
                        if (localJetpackCockpit) {
                            if (isJetpackThrusting) {
                                if (localJetpackFlames) {
                                    localJetpackFlames.visible = true;
                                    localJetpackFlames.scale.set(1.0, flick, 1.0);
                                }
                                if (localJetpackLight) {
                                    localJetpackLight.intensity = 2.4 + Math.random() * 0.8;
                                }
                            } else {
                                if (localJetpackFlames) localJetpackFlames.visible = false;
                                if (localJetpackLight) localJetpackLight.intensity = 0;
                            }
                        }
                    }

                    if (!isJetpackThrusting) {
                        if (!isOnGround || velocityY !== 0) {
                            velocityY += GRAVITY * delta;
                            playerPos.y += velocityY * delta;

                            if (playerPos.y <= EYE_HEIGHT) {
                                playerPos.y = EYE_HEIGHT;
                                velocityY = 0;
                                isOnGround = true;
                            }
                        }
                    }

                    const speedMultiplier = isRidingBike ? 1.85 : 1.0;
                    const actualSpeed = moveSpeed * speedMultiplier * delta;

                    // Echte horizontale Blickrichtung der Kamera auf der XZ-Ebene (vollkommen unabhaengig von Neigung/Pitch)
                    const camDir = new THREE.Vector3();
                    camera.getWorldDirection(camDir);
                    const fwdLen = Math.hypot(camDir.x, camDir.z);
                    let fwdX = 0, fwdZ = -1;
                    if (fwdLen > 0.0001) {
                        fwdX = camDir.x / fwdLen;
                        fwdZ = camDir.z / fwdLen;
                    }
                    const rgtX = -fwdZ;
                    const rgtZ = fwdX;

                    let mX = 0, mZ = 0;
                    if (moveState.forward) { mX += fwdX * actualSpeed; mZ += fwdZ * actualSpeed; isMoving = true; }
                    if (moveState.backward) { mX -= fwdX * actualSpeed; mZ -= fwdZ * actualSpeed; isMoving = true; }
                    if (moveState.right) { mX += rgtX * actualSpeed; mZ += rgtZ * actualSpeed; isMoving = true; }
                    if (moveState.left) { mX -= rgtX * actualSpeed; mZ -= rgtZ * actualSpeed; isMoving = true; }

                    playerPos.x += mX;
                    playerPos.z += mZ;

                    // Hof-AuÃŸengrenze
                    const distFromCenter = Math.hypot(playerPos.x, playerPos.z);
                    if (distFromCenter > 23.3) {
                        const angle = Math.atan2(playerPos.z, playerPos.x);
                        playerPos.x = Math.cos(angle) * 23.3;
                        playerPos.z = Math.sin(angle) * 23.3;
                    }

                    // Kollisionsabfrage: Satellitenraeume
                    for (const room of SATELLITE_ROOMS) {
                        const dx = playerPos.x - room.cx;
                        const dz = playerPos.z - room.cz;
                        const dist = Math.sqrt(dx * dx + dz * dz);

                        if (dist >= 4.85 && dist <= 6.15) {
                            const playerAngle = Math.atan2(dz, dx);
                            let angleDiff = Math.abs(playerAngle - room.doorAngle);
                            while (angleDiff > Math.PI) angleDiff = Math.abs(angleDiff - 2 * Math.PI);

                            if (angleDiff > 0.36) {
                                const pushDist = dist > room.radius ? 6.18 : 4.82;
                                playerPos.x = room.cx + Math.cos(playerAngle) * pushDist;
                                playerPos.z = room.cz + Math.sin(playerAngle) * pushDist;
                            }
                        }
                    }
                }

                // â”€â”€ KAMERA- & AVATAR-POSITIONIERUNG (1ST PERSON VS 3RD PERSON) â”€â”€
                const camDir = new THREE.Vector3();
                camera.getWorldDirection(camDir);
                const fwdLen = Math.hypot(camDir.x, camDir.z);
                const playerYaw = fwdLen > 0.0001 ? Math.atan2(-camDir.x, -camDir.z) : 0;

                if (isThirdPersonMode) {
                    if (localPlayerGroup) {
                        localPlayerGroup.visible = true;
                        if (isSitting && currentSeat) {
                            localPlayerGroup.position.set(currentSeat.sitPos.x, currentSeat.sitPos.y - EYE_HEIGHT, currentSeat.sitPos.z);
                            if (currentSeat.lookDir) {
                                localPlayerGroup.rotation.y = Math.atan2(currentSeat.lookDir.x, currentSeat.lookDir.z) + Math.PI;
                            }
                        } else {
                            localPlayerGroup.position.set(playerPos.x, Math.max(0, playerPos.y - EYE_HEIGHT), playerPos.z);
                            localPlayerGroup.rotation.y = playerYaw;
                        }
                        if (localPlayerJetpack) {
                            localPlayerJetpack.visible = isJetpackEquipped;
                        }
                    }
                    if (localJetpackCockpit) localJetpackCockpit.visible = false;
                    if (localBikeCockpit) localBikeCockpit.visible = false;

                    const lookTarget = (isSitting && currentSeat)
                        ? currentSeat.sitPos.clone().add(new THREE.Vector3(0, 0.15, 0))
                        : playerPos.clone().add(new THREE.Vector3(0, 0.15, 0));

                    const camForward = camDir.clone();
                    const maxCamDist = 2.65;
                    const idealCamPos = lookTarget.clone().sub(camForward.clone().multiplyScalar(maxCamDist));
                    idealCamPos.y += 0.30;

                    // Wandschutz fuer 3rd Person Kamera
                    const camRayDir = idealCamPos.clone().sub(lookTarget);
                    const camRayDist = camRayDir.length();
                    camRayDir.normalize();

                    const camRay = new THREE.Raycaster(lookTarget, camRayDir, 0.15, camRayDist);
                    const wallHits = camRay.intersectObjects(wallMeshes, false);
                    let actualDist = maxCamDist;
                    if (wallHits.length > 0 && wallHits[0].distance < camRayDist) {
                        actualDist = Math.max(0.65, wallHits[0].distance - 0.25);
                    }

                    const actualCamPos = lookTarget.clone().sub(camForward.clone().multiplyScalar(actualDist));
                    actualCamPos.y += (0.30 * (actualDist / maxCamDist));
                    camera.position.copy(actualCamPos);
                } else {
                    if (localPlayerGroup) localPlayerGroup.visible = false;
                    if (isSitting && currentSeat) {
                        camera.position.copy(currentSeat.sitPos);
                    } else {
                        camera.position.copy(playerPos);
                    }
                    if (localJetpackCockpit) localJetpackCockpit.visible = isJetpackEquipped;
                    if (localBikeCockpit) localBikeCockpit.visible = isRidingBike;
                }

                // â”€â”€ TEPPICH-SCHRITTGERÃ„USCHE UPDATE â”€â”€
                footstepAudio.update(delta, isMoving, isOnGround, isSitting);

                // â”€â”€ RAYCASTING INTERAKTIONS-PRÃœFUNG â”€â”€
                raycaster.setFromCamera(centerCoords, camera);

                if (movingChairState) {
                    // Praezise und ruckelfreie Bodenprojektion per mathematischer Ebenen-Schnittpunkt-Berechnung
                    const camDir = new THREE.Vector3();
                    camera.getWorldDirection(camDir);
                    const playerYaw = Math.atan2(camDir.x, camDir.z);
                    const chairRotY = playerYaw + (movingChairState.rotOffset || 0);
                    movingChairState.currentRotY = chairRotY;

                    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
                    const groundHit = new THREE.Vector3();
                    let validHit = null;

                    if (raycaster.ray.direction.y < -0.01) {
                        if (raycaster.ray.intersectPlane(groundPlane, groundHit)) {
                            const d = camera.position.distanceTo(groundHit);
                            if (d >= 0.8 && d <= 12.0) {
                                const distFromCenter = Math.hypot(groundHit.x, groundHit.z);
                                if (distFromCenter <= 24.5) {
                                    validHit = groundHit;
                                }
                            }
                        }
                    }

                    if (validHit) {
                        movingChairState.ghostGroup.visible = true;
                        movingChairState.ghostGroup.position.set(validHit.x, 0, validHit.z);
                        movingChairState.ghostGroup.rotation.y = chairRotY;

                        movingChairState.validTarget = {
                            x: Number(validHit.x.toFixed(3)),
                            z: Number(validHit.z.toFixed(3)),
                            rotY: Number(chairRotY.toFixed(3))
                        };

                        interactPrompt.textContent = "[E] oder [LMB] Abstellen\n[R] Drehen\n[ESC] Abbrechen";
                        interactPrompt.classList.add("visible");
                    } else {
                        movingChairState.ghostGroup.visible = false;
                        movingChairState.validTarget = null;
                        interactPrompt.textContent = "Boden anvisieren zum Abstellen\n[ESC] Abbrechen";
                        interactPrompt.classList.add("visible");
                    }
                } else if (movingNoteState) {
                    let validHit = null;
                    const maxRayDist = 6.5;

                    if (movingNoteState.isImage) {
                        // Kunst-Raum: Bilder kÃ¶nnen an jeder Wand im Kunst-Raum angebracht werden
                        const kunstWalls = wallMeshes.filter(m => m.userData && m.userData.isRoomWall && m.userData.roomName === "Kunst");
                        const hits = raycaster.intersectObjects(kunstWalls, false);
                        if (hits.length > 0 && hits[0].distance <= maxRayDist) {
                            validHit = hits[0];
                        }
                    } else {
                        // Andere RÃ¤ume: Notizen mÃ¼ssen an das Notizboard geheftet werden
                        const hitPinboards = raycaster.intersectObjects(pinboardMeshes, false);
                        if (hitPinboards.length > 0 && hitPinboards[0].distance <= maxRayDist) {
                            validHit = hitPinboards[0];
                        } else {
                            // Kulante Erkennung: Falls der Ray die Raumwand hinter dem Pinboard trifft
                            const hitWalls = raycaster.intersectObjects(wallMeshes, false);
                            if (hitWalls.length > 0 && hitWalls[0].distance <= maxRayDist) {
                                const wallHit = hitWalls[0];
                                if (wallHit.object.userData && wallHit.object.userData.isRoomWall && wallHit.object.userData.roomName !== "Kunst") {
                                    const rName = wallHit.object.userData.roomName;
                                    const matchingPinboard = pinboardMeshes.find(p => p.userData && p.userData.roomName === rName);
                                    if (matchingPinboard) {
                                        const cx = wallHit.object.userData.roomCenter.x;
                                        const cz = wallHit.object.userData.roomCenter.y;
                                        const hitAngle = Math.atan2(wallHit.point.z - cz, wallHit.point.x - cx);
                                        const pinAngle = matchingPinboard.userData.pinAngle;
                                        let diff = Math.abs(hitAngle - pinAngle);
                                        while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
                                        if (diff <= (matchingPinboard.userData.boardArc || 1.05) / 2 + 0.15) {
                                            validHit = wallHit;
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if (validHit && validHit.object.userData && validHit.object.userData.roomCenter) {
                        movingNoteState.ghostFrame.visible = true;
                        const cx = validHit.object.userData.roomCenter.x;
                        const cz = validHit.object.userData.roomCenter.y;
                        const radial = new THREE.Vector3(validHit.point.x - cx, 0, validHit.point.z - cz).normalize();
                        const toPlayer = camera.position.clone().sub(validHit.point).normalize();
                        const normal = radial.dot(toPlayer) >= 0 ? radial : radial.negate();

                        const offset = 0.04;
                        const targetPos = validHit.point.clone().add(normal.clone().multiplyScalar(offset));
                        movingNoteState.ghostFrame.position.copy(targetPos);
                        movingNoteState.ghostFrame.lookAt(targetPos.clone().add(normal));

                        movingNoteState.validTarget = {
                            pos: {
                                x: Number(targetPos.x.toFixed(3)),
                                y: Number(targetPos.y.toFixed(3)),
                                z: Number(targetPos.z.toFixed(3))
                            },
                            normal: {
                                x: Number(normal.x.toFixed(3)),
                                y: Number(normal.y.toFixed(3)),
                                z: Number(normal.z.toFixed(3))
                            }
                        };
                        interactPrompt.textContent = "[E] oder [LMB] Anheften\n[ESC] Abbrechen";
                        interactPrompt.classList.add("visible");
                    } else {
                        movingNoteState.ghostFrame.visible = false;
                        movingNoteState.validTarget = null;
                        interactPrompt.textContent = movingNoteState.isImage
                            ? "Wand in Kunst anvisieren\n[ESC] Abbrechen"
                            : "Notizwand anvisieren\n[ESC] Abbrechen";
                        interactPrompt.classList.add("visible");
                    }
                } else {
                    // 1. Notizen (Text & Bild)
                    const noteMeshes = Array.from(notesMeshMap.values());
                    const hitNotes = raycaster.intersectObjects(noteMeshes, false);

                    if (hitNotes.length > 0 && hitNotes[0].distance <= 3.6) {
                        const hitObj = hitNotes[0].object;
                        currentInteractTarget = {
                            type: 'note',
                            noteId: hitObj.userData.id,
                            data: hitObj.userData.data
                        };
                        interactPrompt.textContent = hitObj.userData.isImage 
                            ? "[LMB] Bild ansehen\n[E] Verschieben" 
                            : "[LMB] Notiz ansehen\n[E] Verschieben";
                        interactPrompt.classList.add("visible");
                    } else {
                        // 2. Fahrrad Interaktion
                        let hitBike = false;
                        if (bikeInteractMesh && worldBikeGroup && worldBikeGroup.visible && !isRidingBike) {
                            const bikeHits = raycaster.intersectObject(bikeInteractMesh, false);
                            if (bikeHits.length > 0 && bikeHits[0].distance <= 2.8) {
                                currentInteractTarget = { type: 'bike' };
                                interactPrompt.textContent = "[E] Fahrrad fahren";
                                interactPrompt.classList.add("visible");
                                hitBike = true;
                            }
                        }

                        // 3. Jetpack Interaktion (4 Jetpacks im Lager oder wo sie gedroppt wurden)
                        let hitJp = false;
                        if (!hitBike && !isJetpackEquipped && warehouseJetpacks.length > 0) {
                            const availableHitBoxes = warehouseJetpacks
                                .filter(jp => jp.group && jp.group.visible && !jp.isEquipped && jp.hitBox)
                                .map(jp => jp.hitBox);

                            if (availableHitBoxes.length > 0) {
                                const jpHits = raycaster.intersectObjects(availableHitBoxes, false);
                                if (jpHits.length > 0 && jpHits[0].distance <= 3.8) {
                                    const hitJpObj = jpHits[0].object.userData.jetpackObj;
                                    currentInteractTarget = { type: 'jetpack', jetpackObj: hitJpObj };
                                    interactPrompt.textContent = "[E] Jetpack anlegen";
                                    interactPrompt.classList.add("visible");
                                    hitJp = true;
                                }
                            }
                        }

                        // 3b. Cinema Steuerung: Bedienpult an der Wand oder Screen
                        let hitCinema = false;
                        const chillenRoomInteractObj = SATELLITE_ROOMS.find(r => r.name === "Chillen");
                        const chIntX = chillenRoomInteractObj ? chillenRoomInteractObj.cx : 9.698;
                        const chIntZ = chillenRoomInteractObj ? chillenRoomInteractObj.cz : 13.349;
                        const distToChillenInteract = Math.hypot(camera.position.x - chIntX, camera.position.z - chIntZ);
                        const inChillenForInteract = (distToChillenInteract <= 8.5);

                        if (!hitBike && !hitJp && inChillenForInteract) {
                            // 1. Raycast auf Cinema Bedienpult Meshes (3D Buttons & Scrubber)
                            let hitCinemaControl = false;
                            if (cinemaControlMeshes.length > 0) {
                                const ctrlHits = raycaster.intersectObjects(cinemaControlMeshes, false);
                                if (ctrlHits.length > 0 && ctrlHits[0].distance <= 6.5) {
                                    const hitObj = ctrlHits[0].object;
                                    hitCinemaControl = true;

                                    if (hoveredControlMesh !== hitObj) {
                                        if (hoveredControlMesh) setControlMeshEmissive(hoveredControlMesh, 0x000000, 0);
                                        hoveredControlMesh = hitObj;
                                        setControlMeshEmissive(hoveredControlMesh, 0x38bdf8, 0.4);
                                    }

                                    let prompt = hitObj.userData.promptText || '[LMB] Interagieren';
                                    let seekTime = null;

                                    if (hitObj.userData.action === 'scrubber') {
                                        const localPt = hitObj.worldToLocal(ctrlHits[0].point.clone());
                                        const tw = hitObj.userData.trackWidth || 1.04;
                                        const ratio = Math.max(0, Math.min(1, (localPt.x + tw / 2) / tw));
                                        const dur = ytPlayerDuration || (ytPlayer && ytPlayer.getDuration ? ytPlayer.getDuration() : 0) || 0;
                                        seekTime = dur * ratio;
                                        if (dur > 0) {
                                            prompt = `[LMB] Zu ${formatTime(seekTime)} spulen`;
                                        } else {
                                            prompt = `[LMB] Spulen`;
                                        }
                                    } else if (hitObj.userData.action === 'playpause') {
                                        prompt = currentCinemaPlaying ? '[LMB] Pausieren' : '[LMB] Abspielen';
                                    }

                                    currentInteractTarget = {
                                        type: 'cinemaControl',
                                        action: hitObj.userData.action,
                                        mesh: hitObj,
                                        seekTime: seekTime
                                    };
                                    interactPrompt.textContent = prompt;
                                    interactPrompt.classList.add("visible");
                                    hitCinema = true;
                                }
                            }
                            if (!hitCinemaControl && hoveredControlMesh) {
                                setControlMeshEmissive(hoveredControlMesh, 0x000000, 0);
                                hoveredControlMesh = null;
                            }

                            // 2. Klick direkt auf Kinoleinwand
                            if (!hitCinemaControl && (cinemaScreenMesh || cinemaInteractMesh)) {
                                const cinemaTargets = [];
                                if (cinemaScreenMesh) cinemaTargets.push(cinemaScreenMesh);
                                if (cinemaInteractMesh) cinemaTargets.push(cinemaInteractMesh);
                                const cHits = raycaster.intersectObjects(cinemaTargets, false);

                                if (cHits.length > 0 && cHits[0].distance <= 12.0) {
                                    currentInteractTarget = { type: 'cinema' };
                                    interactPrompt.textContent = currentCinemaVideoId
                                        ? (currentCinemaPlaying ? '[LMB] Pausieren' : '[LMB] Abspielen')
                                        : '[LMB] YouTube-Video laden';
                                    interactPrompt.classList.add("visible");
                                    hitCinema = true;
                                }
                            }
                        }
                        updateControlPanelDisplay();

                        // 3c. Chillen-Stehlampe Interaktion
                        let hitLamp = false;
                        if (!hitBike && !hitJp && !hitCinema && chillenLampInteractMesh) {
                            const lampHits = raycaster.intersectObject(chillenLampInteractMesh, false);
                            if (lampHits.length > 0 && lampHits[0].distance <= 3.8) {
                                currentInteractTarget = { type: 'chillenLamp' };
                                interactPrompt.textContent = isChillenLampOn
                                    ? "[E] oder [LMB] Lampe ausschalten"
                                    : "[E] oder [LMB] Lampe einschalten";
                                interactPrompt.classList.add("visible");
                                hitLamp = true;
                            }
                        }

                        // 3d. Lager Aufraeumen-Button
                        let hitResetBtn = false;
                        if (!hitBike && !hitJp && !hitCinema && !hitLamp && warehouseResetButtonMesh) {
                            const btnHits = raycaster.intersectObject(warehouseResetButtonMesh, true);
                            if (btnHits.length > 0 && btnHits[0].distance <= 3.2) {
                                currentInteractTarget = { type: 'warehouseResetButton' };
                                interactPrompt.textContent = "[E] oder [LMB] Stuehle aufraeumen";
                                interactPrompt.classList.add("visible");
                                hitResetBtn = true;
                            }
                        }

                        if (!hitBike && !hitJp && !hitCinema && !hitLamp && !hitResetBtn) {
                            // 4. Sitze (Sitzen immer LMB, Stuhl verschieben immer E)
                            const hitSeats = !isSitting ? raycaster.intersectObjects(seatMeshes, false) : [];
                            if (hitSeats.length > 0 && hitSeats[0].distance <= 2.8) {
                                const hitObj = hitSeats[0].object;
                                const seat = hitObj.userData.seat;
                                if (hitObj.userData.isMovableChair) {
                                    currentInteractTarget = {
                                        type: 'movableChair',
                                        chair: hitObj.userData.chairObj,
                                        seat: seat
                                    };
                                    interactPrompt.textContent = "[LMB] Hinsetzen\n[E] Stuhl verschieben";
                                } else {
                                    currentInteractTarget = {
                                        type: 'seat',
                                        seat: seat
                                    };
                                    interactPrompt.textContent = "[LMB] Hinsetzen";
                                }
                                interactPrompt.classList.add("visible");
                            } else {
                                // 5. Pinboards
                                const hitPinboards = raycaster.intersectObjects(pinboardMeshes, false);
                                if (hitPinboards.length > 0 && hitPinboards[0].distance <= 4.0) {
                                    currentInteractTarget = {
                                        type: 'pinboard',
                                        hit: hitPinboards[0]
                                    };
                                    interactPrompt.textContent = "[LMB] Notiz anheften";
                                    interactPrompt.classList.add("visible");
                                } else {
                                    // 6. ArtWall
                                    const hitWalls = raycaster.intersectObjects(wallMeshes, false);
                                    if (hitWalls.length > 0 && hitWalls[0].distance <= 4.2) {
                                        const wallHit = hitWalls[0];
                                        if (wallHit.object.userData && wallHit.object.userData.isRoomWall && wallHit.object.userData.roomName === "Kunst") {
                                            currentInteractTarget = {
                                                type: 'artWall',
                                                hit: wallHit
                                            };
                                            interactPrompt.textContent = "[LMB] Bild anpinnen";
                                            interactPrompt.classList.add("visible");
                                        } else {
                                            currentInteractTarget = null;
                                            interactPrompt.classList.remove("visible");
                                        }
                                    } else {
                                        currentInteractTarget = null;
                                        if (isSitting) {
                                            interactPrompt.textContent = "[LMB] oder [LEERTASTE] Aufstehen";
                                            interactPrompt.classList.add("visible");
                                        } else if (isRidingBike) {
                                            interactPrompt.textContent = "[E] oder [ESC] Absteigen";
                                            interactPrompt.classList.add("visible");
                                        } else if (isJetpackEquipped) {
                                            interactPrompt.textContent = "[LEERTASTE] Schub nach oben\n[E] Jetpack ablegen";
                                            interactPrompt.classList.add("visible");
                                        } else {
                                            interactPrompt.classList.remove("visible");
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            } else {
                interactPrompt.classList.remove("visible");
            }

            // â”€â”€ PROJEKTOR-LICHTSTRAHL & STATUS-LED SYNCHRONISIEREN â”€â”€
            if (projectorBeamMesh) {
                const isVideoPlaying = Boolean(currentCinemaVideoId) && Boolean(currentCinemaPlaying);
                projectorBeamMesh.visible = isVideoPlaying;
                if (projectorFlareMesh) projectorFlareMesh.visible = isVideoPlaying;
                if (projectorLedMesh) {
                    projectorLedMesh.material.color.setHex(isVideoPlaying ? 0x10b981 : 0xf59e0b);
                }
                if (isVideoPlaying) {
                    const t = clock.getElapsedTime();
                    const flicker = 0.28 + 0.04 * Math.sin(t * 8.5) + 0.02 * Math.cos(t * 14.0);
                    if (projectorBeamMesh.material.uniforms && projectorBeamMesh.material.uniforms.uOpacity) {
                        projectorBeamMesh.material.uniforms.uOpacity.value = flicker;
                    }
                }
            }

            // â”€â”€ LAGER-MUECKEN & LICHTSTRAHL DER LAGERLAMPE ANIMIEREN â”€â”€
            if (warehouseMosquitoes) {
                updateWarehouseMosquitoes(delta);
            }
            if (warehouseLampBeamMesh && warehouseLampBeamMesh.material.uniforms && warehouseLampBeamMesh.material.uniforms.uOpacity) {
                const t = clock.getElapsedTime ? clock.getElapsedTime() : performance.now() * 0.001;
                const lampFlicker = 0.28 + 0.025 * Math.sin(t * 4.2) + 0.015 * Math.cos(t * 9.1);
                warehouseLampBeamMesh.material.uniforms.uOpacity.value = lampFlicker;
            }

            renderer.render(scene, camera);

            // â”€â”€ CSS3D ON-WALL VIDEO RENDERN (NUR IM CHILLEN-KREIS-RAUM SICHTBAR) â”€â”€
            // ── CSS3D ON-WALL VIDEO RENDERN (IMMER RENDERN, SICHTBARKEIT PER OPACITY) ──
            if (cssRenderer && cssScene) {
                const px = camera.position.x;
                const py = camera.position.y;
                const pz = camera.position.z;
                const chillenRoomObj = SATELLITE_ROOMS.find(r => r.name === "Chillen");
                const chX = chillenRoomObj ? chillenRoomObj.cx : 9.698;
                const chZ = chillenRoomObj ? chillenRoomObj.cz : 13.349;
                const distToChillen = Math.hypot(px - chX, pz - chZ);

                // Leinwand sichtbar, wenn man sich im oder nahe am "Chillen"-Raum befindet
                const inChillenRoom = (py >= -0.5 && py <= 6.5 && distToChillen <= 8.5);

                const wrapper = document.getElementById('cinema-inworld-wrapper');
                if (wrapper) {
                    wrapper.style.opacity = (inChillenRoom && currentCinemaVideoId) ? '1' : '0';
                }

                cssRenderer.render(cssScene, camera);
            }
        }

        // â”€â”€ TEXT-NOTIZ MODAL (PINBOARD) â”€â”€
        function openNoteModal(hit) {
            if (!hit || !hit.point) return;

            const cx = hit.object.userData.roomCenter.x;
            const cz = hit.object.userData.roomCenter.y;
            const radial = new THREE.Vector3(hit.point.x - cx, 0, hit.point.z - cz).normalize();
            const toPlayer = camera.position.clone().sub(hit.point).normalize();
            const normal = radial.dot(toPlayer) >= 0 ? radial : radial.negate();

            savedPinTarget = {
                point: hit.point.clone(),
                normal: normal.clone()
            };

            isModalOpen = true;
            moveState.forward = moveState.backward = moveState.left = moveState.right = false;
            if (controls && controls.isLocked) controls.unlock();

            noteTextarea.value = "";
            noteModal.classList.add("visible");
            interactPrompt.classList.remove("visible");
            setTimeout(() => noteTextarea.focus(), 60);
        }

        function closeModal() {
            isModalOpen = false;
            noteModal.classList.remove("visible");
            savedPinTarget = null;
            moveState.forward = moveState.backward = moveState.left = moveState.right = false;
        }

        btnCancelNote.addEventListener("click", () => {
            closeModal();
            try {
                if (controls && !controls.isLocked) controls.lock();
            } catch (err) {}
        });

        noteTextarea.addEventListener("keydown", (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                btnSaveNote.click();
            }
        });

        btnSaveNote.addEventListener("click", async () => {
            const text = noteTextarea.value.trim();
            if (!text) {
                alert("Bitte gib einen Text fÃ¼r deine Notiz ein.");
                return;
            }

            if (!savedPinTarget) {
                closeModal();
                return;
            }

            const target = savedPinTarget;
            closeModal();

            try {
                if (controls && !controls.isLocked) controls.lock();
            } catch (err) {}

            const offset = 0.04;
            const pos = {
                x: Number((target.point.x + target.normal.x * offset).toFixed(3)),
                y: Number(Math.max(0.6, Math.min(WALL_HEIGHT - 0.4, target.point.y)).toFixed(3)),
                z: Number((target.point.z + target.normal.z * offset).toFixed(3))
            };

            const norm = {
                x: Number(target.normal.x.toFixed(3)),
                y: Number(target.normal.y.toFixed(3)),
                z: Number(target.normal.z.toFixed(3))
            };

            const authorName = getStoredNickname();

            try {
                await addDoc(collection(db, "notes"), {
                    type: "text",
                    text: text,
                    author: authorName,
                    position: pos,
                    normal: norm,
                    createdAt: serverTimestamp()
                });
            } catch (err) {
                console.error("Fehler beim Speichern der Notiz:", err);
                alert("Fehler beim Anpinnen: " + (err.message || "Unbekannter Fehler"));
            }
        });

        // â”€â”€ ART BILD-NOTIZ MODAL (ART-RAUM) â”€â”€
        function openArtModal(hit) {
            if (!hit || !hit.point) return;

            const cx = hit.object.userData.roomCenter.x;
            const cz = hit.object.userData.roomCenter.y;
            const radial = new THREE.Vector3(hit.point.x - cx, 0, hit.point.z - cz).normalize();
            const toPlayer = camera.position.clone().sub(hit.point).normalize();
            const normal = radial.dot(toPlayer) >= 0 ? radial : radial.negate();

            savedPinTarget = {
                point: hit.point.clone(),
                normal: normal.clone()
            };

            compressedArtData = null;
            artFileInput.value = "";
            artCaptionInput.value = "";
            artFileInfo.textContent = "Keine Datei ausgewÃ¤hlt";
            artPreviewWrapper.style.display = "none";
            btnSaveArt.disabled = true;

            isModalOpen = true;
            moveState.forward = moveState.backward = moveState.left = moveState.right = false;
            if (controls && controls.isLocked) controls.unlock();

            artNoteModal.classList.add("visible");
            interactPrompt.classList.remove("visible");
        }

        function closeArtModal() {
            isModalOpen = false;
            artNoteModal.classList.remove("visible");
            compressedArtData = null;
            savedPinTarget = null;
            moveState.forward = moveState.backward = moveState.left = moveState.right = false;
        }

        btnBrowseArt.addEventListener("click", () => {
            artFileInput.click();
        });

        artFileInput.addEventListener("change", async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;

            artFileInfo.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB) - Komprimiere...`;
            btnSaveArt.disabled = true;

            try {
                const compressed = await compressImageToMax100KB(file);
                compressedArtData = compressed;

                artPreviewImg.src = compressed.dataUrl;
                artPreviewWrapper.style.display = "block";
                artCompressInfo.textContent = `GrÃ¶ÃŸe: ${(compressed.byteSize / 1024).toFixed(1)} KB (â‰¤ 100 KB komprimiert)`;
                artFileInfo.textContent = file.name;
                btnSaveArt.disabled = false;
            } catch (err) {
                console.error("Komprimierungsfehler:", err);
                alert("Fehler bei der Bildkomprimierung: " + err.message);
                artFileInfo.textContent = "Fehler beim Laden";
                btnSaveArt.disabled = true;
            }
        });

        btnCancelArt.addEventListener("click", () => {
            closeArtModal();
            try {
                if (controls && !controls.isLocked) controls.lock();
            } catch (err) {}
        });

        btnSaveArt.addEventListener("click", async () => {
            if (!compressedArtData || !compressedArtData.dataUrl) {
                alert("Bitte wÃ¤hle zuerst ein Bild aus.");
                return;
            }

            if (!savedPinTarget) {
                closeArtModal();
                return;
            }

            btnSaveArt.disabled = true;
            btnSaveArtText.textContent = "Wird angepinnt...";
            btnSaveArtSpinner.classList.remove("hidden");

            const target = savedPinTarget;
            const caption = artCaptionInput.value.trim();
            const authorName = getStoredNickname();

            const offset = 0.04;
            const pos = {
                x: Number((target.point.x + target.normal.x * offset).toFixed(3)),
                y: Number(Math.max(0.7, Math.min(WALL_HEIGHT - 0.7, target.point.y)).toFixed(3)),
                z: Number((target.point.z + target.normal.z * offset).toFixed(3))
            };

            const norm = {
                x: Number(target.normal.x.toFixed(3)),
                y: Number(target.normal.y.toFixed(3)),
                z: Number(target.normal.z.toFixed(3))
            };

            try {
                await addDoc(collection(db, "notes"), {
                    type: "image",
                    imageUrl: compressedArtData.dataUrl,
                    caption: caption,
                    author: authorName,
                    position: pos,
                    normal: norm,
                    createdAt: serverTimestamp()
                });
                closeArtModal();
                try {
                    if (controls && !controls.isLocked) controls.lock();
                } catch (err) {}
            } catch (err) {
                console.error("Fehler beim Hochladen:", err);
                alert("Fehler beim Hochladen: " + (err.message || "Unbekannter Fehler"));
            } finally {
                btnSaveArt.disabled = false;
                btnSaveArtText.textContent = "Bild anpinnen";
                btnSaveArtSpinner.classList.add("hidden");
            }
        });

        // â”€â”€ NOTIZEN VERSCHIEBEN [E] (MIT BLAUEM 3D-RAHMEN & FIRESTORE-UPDATE) â”€â”€
        function startMovingNote() {
            if (!currentInteractTarget || currentInteractTarget.type !== 'note') return;
            const noteId = currentInteractTarget.noteId;
            const data = currentInteractTarget.data;
            const origMesh = notesMeshMap.get(noteId);
            if (!origMesh) return;

            const isImage = data.type === 'image';
            const w = isImage ? 1.2 : 0.85;
            const h = isImage ? 1.2 : 0.85;

            // Blauer Rahmen in Form des Notizzettels
            const planeGeo = new THREE.PlaneGeometry(w, h);
            const edgesGeo = new THREE.EdgesGeometry(planeGeo);
            const lineMat = new THREE.LineBasicMaterial({
                color: 0x38bdf8,
                linewidth: 3,
                depthTest: false
            });
            const ghostFrame = new THREE.LineSegments(edgesGeo, lineMat);
            ghostFrame.renderOrder = 999;

            // Dezente halbtransparente blaue Vorschau-FÃ¼llung
            const fillMat = new THREE.MeshBasicMaterial({
                color: 0x0284c7,
                transparent: true,
                opacity: 0.18,
                side: THREE.DoubleSide,
                depthTest: false
            });
            const fillMesh = new THREE.Mesh(planeGeo, fillMat);
            fillMesh.renderOrder = 998;
            ghostFrame.add(fillMesh);

            ghostFrame.visible = false;
            scene.add(ghostFrame);

            // Original-Mesh wÃ¤hrend des Verschiebens ausblenden
            origMesh.visible = false;

            movingNoteState = {
                noteId: noteId,
                data: data,
                mesh: origMesh,
                ghostFrame: ghostFrame,
                isImage: isImage,
                validTarget: null
            };

            currentInteractTarget = null;
            interactPrompt.textContent = "[E] oder [LMB] Anheften\n[ESC] Abbrechen";
            interactPrompt.classList.add("visible");
        }

        async function pinMovingNote() {
            if (!movingNoteState || !movingNoteState.validTarget) return;
            const targetState = movingNoteState;
            movingNoteState = null;

            const ghost = targetState.ghostFrame;
            if (ghost) {
                scene.remove(ghost);
                ghost.traverse((c) => {
                    if (c.geometry) c.geometry.dispose();
                    if (c.material) c.material.dispose();
                });
            }

            try {
                const noteRef = firestoreDoc(db, "notes", targetState.noteId);
                await updateDoc(noteRef, {
                    position: targetState.validTarget.pos,
                    normal: targetState.validTarget.normal
                });
            } catch (err) {
                console.error("Fehler beim Verschieben der Notiz:", err);
                alert("Fehler beim Verschieben: " + (err.message || "Unbekannter Fehler"));
                if (targetState.mesh) targetState.mesh.visible = true;
            }
        }

        function cancelMovingNote() {
            if (!movingNoteState) return;
            if (movingNoteState.mesh) {
                movingNoteState.mesh.visible = true;
            }
            const ghost = movingNoteState.ghostFrame;
            if (ghost) {
                scene.remove(ghost);
                ghost.traverse((c) => {
                    if (c.geometry) c.geometry.dispose();
                    if (c.material) c.material.dispose();
                });
            }
            movingNoteState = null;
            interactPrompt.classList.remove("visible");
        }

        // â”€â”€ 3D NOTIZEN RENDERING (TEXT & BILDER) â”€â”€
        function createTextNoteTexture(text, author, dateStr) {
            const canvas = document.createElement("canvas");
            canvas.width = 512;
            canvas.height = 512;
            const ctx = canvas.getContext("2d");

            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, 512, 512);

            // Frameless Notiz-Tile: kein stÃ¶render schwarzer Rand

            ctx.fillStyle = "#000000";
            ctx.fillRect(196, 14, 120, 24);

            ctx.fillStyle = "#000000";
            ctx.font = 'bold 30px "Quicksand", sans-serif';
            ctx.textAlign = "left";
            ctx.textBaseline = "top";

            const words = (text || "").split(/\s+/);
            const maxWidth = 450;
            const lineHeight = 42;
            let line = "";
            let y = 64;

            for (let n = 0; n < words.length; n++) {
                const testLine = line + (line ? " " : "") + words[n];
                const metrics = ctx.measureText(testLine);
                if (metrics.width > maxWidth && line.length > 0) {
                    ctx.fillText(line, 30, y);
                    line = words[n];
                    y += lineHeight;
                    if (y > 390) {
                        line = "...";
                        break;
                    }
                } else {
                    line = testLine;
                }
            }
            if (line) {
                ctx.fillText(line, 30, y);
            }

            ctx.font = '600 20px "Quicksand", sans-serif';
            ctx.fillStyle = "#444444";
            const authorStr = author ? (author.length > 18 ? author.slice(0, 16) + "..." : author) : "Anonym";
            const dateFormatted = dateStr || "Heute";
            ctx.fillText(`${authorStr}, ${dateFormatted}`, 30, 462);

            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.needsUpdate = true;
            return texture;
        }

        function createImageNoteTexture(img, caption, author, dateStr) {
            const canvas = document.createElement("canvas");
            canvas.width = 640;
            canvas.height = 640;
            const ctx = canvas.getContext("2d");

            // WeiÃŸer Galerierahmen
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, 640, 640);

            // Frameless Bild-Tile

            // Passepartout / Bildfeld
            ctx.fillStyle = "#0c0a09";
            ctx.fillRect(20, 20, 600, 500);

            // Bild einpassen
            const imgAspect = img.width / img.height;
            const targetW = 600;
            const targetH = 500;
            let dw = targetW, dh = targetH, dx = 20, dy = 20;

            if (imgAspect > targetW / targetH) {
                dh = Math.round(targetW / imgAspect);
                dy = 20 + Math.round((targetH - dh) / 2);
            } else {
                dw = Math.round(targetH * imgAspect);
                dx = 20 + Math.round((targetW - dw) / 2);
            }
            ctx.drawImage(img, dx, dy, dw, dh);

            // Galerie-Plakette unten
            ctx.fillStyle = "#111111";
            ctx.font = 'bold 22px "Quicksand", sans-serif';
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            const title = caption ? (caption.length > 28 ? caption.slice(0, 26) + "â€¦" : caption) : "Ohne Titel";
            ctx.fillText(title, 24, 552);

            ctx.font = '600 16px "Quicksand", sans-serif';
            ctx.fillStyle = "#666666";
            const sig = `${author || "Anonym"}, ${dateStr || "Heute"}`;
            ctx.fillText(sig, 24, 592);

            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.needsUpdate = true;
            return texture;
        }

        function createNoteMesh(data, id) {
            try {
                const dateStr = formatNoteDate(data.createdAt);
                const isImage = data.type === "image" && data.imageUrl;

                let mesh;
                if (isImage) {
                    const geo = new THREE.PlaneGeometry(1.2, 1.2);
                    const mat = new THREE.MeshBasicMaterial({
                        color: 0xffffff,
                        side: THREE.DoubleSide,
                        toneMapped: false
                    });
                    mesh = new THREE.Mesh(geo, mat);

                    const img = new Image();
                    img.onload = () => {
                        const texture = createImageNoteTexture(img, data.caption, data.author, dateStr);
                        texture.colorSpace = THREE.SRGBColorSpace;
                        mat.map = texture;
                        mat.needsUpdate = true;
                    };
                    img.src = data.imageUrl;
                } else {
                    const texture = createTextNoteTexture(data.text, data.author, dateStr);
                    texture.colorSpace = THREE.SRGBColorSpace;
                    const geo = new THREE.PlaneGeometry(0.85, 0.85);
                    const mat = new THREE.MeshBasicMaterial({
                        map: texture,
                        side: THREE.DoubleSide,
                        toneMapped: false
                    });
                    mesh = new THREE.Mesh(geo, mat);
                }

                mesh.position.set(data.position.x, data.position.y, data.position.z);

                let normal = data.normal && typeof data.normal.x === "number"
                    ? new THREE.Vector3(data.normal.x, data.normal.y, data.normal.z).normalize()
                    : new THREE.Vector3(0, 0, 1);

                if (normal.lengthSq() < 0.1) normal = new THREE.Vector3(0, 0, 1);

                mesh.lookAt(mesh.position.clone().add(normal));
                mesh.userData = { id: id, data: data, isNote: true, isImage: isImage };
                return mesh;
            } catch (err) {
                console.error("Fehler beim Erstellen des Notiz-Meshes:", err);
                return null;
            }
        }

        function clearAllNoteMeshes() {
            notesMeshMap.forEach((mesh) => {
                scene.remove(mesh);
                if (mesh.geometry) mesh.geometry.dispose();
                if (mesh.material) {
                    if (mesh.material.map) mesh.material.map.dispose();
                    mesh.material.dispose();
                }
            });
            notesMeshMap.clear();
        }

        // â”€â”€ FIRESTORE ECHTZEIT-ABRUF â”€â”€
        function subscribeToNotes() {
            if (unsubscribeNotes) return;

            const notesCol = collection(db, "notes");
            unsubscribeNotes = onSnapshot(notesCol, (snapshot) => {
                snapshot.docChanges().forEach((change) => {
                    const id = change.doc.id;
                    const data = change.doc.data();

                    if (change.type === "added" || change.type === "modified") {
                        if (notesMeshMap.has(id)) {
                            const old = notesMeshMap.get(id);
                            scene.remove(old);
                            if (old.geometry) old.geometry.dispose();
                            if (old.material) {
                                if (old.material.map) old.material.map.dispose();
                                old.material.dispose();
                            }
                            notesMeshMap.delete(id);
                        }

                        if (data && data.position && 
                            typeof data.position.x === "number" && !isNaN(data.position.x) &&
                            typeof data.position.y === "number" && !isNaN(data.position.y) &&
                            typeof data.position.z === "number" && !isNaN(data.position.z)) {
                            const noteMesh = createNoteMesh(data, id);
                            if (noteMesh) {
                                scene.add(noteMesh);
                                notesMeshMap.set(id, noteMesh);
                            }
                        }
                    } else if (change.type === "removed") {
                        if (notesMeshMap.has(id)) {
                            const old = notesMeshMap.get(id);
                            scene.remove(old);
                            if (old.geometry) old.geometry.dispose();
                            if (old.material) {
                                if (old.material.map) old.material.map.dispose();
                                old.material.dispose();
                            }
                            notesMeshMap.delete(id);
                        }
                    }
                });
            }, (err) => {
                console.error("Firestore onSnapshot Fehler:", err);
            });
        }

        // â”€â”€ MULTIPLAYER SPIELER-SYNCHRONISATION â”€â”€
        const remotePlayersMap = new Map();
        let myPlayerRef = null;
        let syncTimer = null;
        let lastSent = { x: 0, y: 0, z: 0, rotY: 0 };
        let rtdbListeners = [];

        function getPlayerColor(str) {
            const colors = [
                "#3b82f6", "#10b981", "#f59e0b", "#ec4899", 
                "#8b5cf6", "#06b6d4", "#f97316", "#e11d48", 
                "#14b8a6", "#84cc16"
            ];
            let hash = 0;
            for (let i = 0; i < (str || "").length; i++) {
                hash = (hash << 5) - hash + str.charCodeAt(i);
                hash |= 0;
            }
            return colors[Math.abs(hash) % colors.length];
        }

        function createNameTagSprite(name, color) {
            const canvas = document.createElement("canvas");
            canvas.width = 512;
            canvas.height = 128;
            const ctx = canvas.getContext("2d");

            ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
            ctx.strokeStyle = color || "#ffffff";
            ctx.lineWidth = 6;
            
            const r = 32;
            const x = 16, y = 16, w = 480, h = 96;
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.arcTo(x + w, y, x + w, y + h, r);
            ctx.arcTo(x + w, y + h, x, y + h, r);
            ctx.arcTo(x, y + h, x, y, r);
            ctx.arcTo(x, y, x + w, y, r);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.font = 'bold 38px "Quicksand", sans-serif';
            ctx.fillStyle = "#ffffff";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            const displayName = name.length > 22 ? name.slice(0, 20) + "â€¦" : name;
            ctx.fillText(displayName, 256, 64);

            const texture = new THREE.CanvasTexture(canvas);
            texture.needsUpdate = true;
            const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
            const sprite = new THREE.Sprite(spriteMat);
            sprite.position.set(0, 2.15, 0);
            sprite.scale.set(1.4, 0.35, 1);
            return sprite;
        }

        function disposeHierarchy(obj) {
            obj.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach((m) => {
                            if (m.map) m.map.dispose();
                            m.dispose();
                        });
                    } else {
                        if (child.material.map) child.material.map.dispose();
                        child.material.dispose();
                    }
                }
            });
        }

        // â”€â”€ REMOTE SPIELER AVATAR ZUSATZ-MODELLE (FAHRRAD & JETPACK) â”€â”€
        function createRemoteBikeModel() {
            const b = new THREE.Group();
            const blueMat = new THREE.MeshLambertMaterial({ color: 0x2563eb });
            const blackMat = new THREE.MeshLambertMaterial({ color: 0x18181b });
            const silverMat = new THREE.MeshLambertMaterial({ color: 0xd4d4d8 });

            // RÃ¤der in Fahrtrichtung (YZ-Ebene) drehen: Vorderrad bei -0.45, Hinterrad bei +0.45
            [-0.45, 0.45].forEach(wz => {
                const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.03, 8, 16), blackMat);
                wheel.rotation.y = Math.PI / 2;
                wheel.position.set(0, 0.24, wz);
                b.add(wheel);
            });

            // Hauptrahmenrohr entlang Z
            const frame = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.85, 8), blueMat);
            frame.rotation.x = Math.PI / 2;
            frame.position.set(0, 0.38, 0);
            b.add(frame);

            // Sattelrohr hinten (+Z)
            const sTube = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.45, 8), blueMat);
            sTube.position.set(0, 0.52, 0.12);
            b.add(sTube);

            // Sattel auf dem Sattelrohr
            const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.22), blackMat);
            saddle.position.set(0, 0.74, 0.12);
            b.add(saddle);

            // Lenker vorne (-Z, wo das Avatar-Visier hinschaut)
            const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.44, 8), silverMat);
            bar.rotation.z = Math.PI / 2;
            bar.position.set(0, 0.78, -0.35);
            b.add(bar);

            // Vorbau / Gabelrohr nach vorn
            const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.40, 8), blueMat);
            stem.position.set(0, 0.58, -0.38);
            stem.rotation.x = 0.25;
            b.add(stem);

            return b;
        }

        function createRemoteJetpackModel() {
            const jp = createRedesignedJetpackModel({ id: 'remote' });
            jp.rotation.y = Math.PI;
            jp.position.set(0, 0.85, 0.16);
            return jp;
        }

        function addRemotePlayer(uid, data) {
            if (remotePlayersMap.has(uid)) {
                updateRemotePlayer(uid, data);
                return;
            }

            const color = data.color || getPlayerColor(uid);
            const nickname = data.nickname || (data.email ? data.email.split("@")[0] : "Gast");

            const group = new THREE.Group();

            const shoeMat = new THREE.MeshLambertMaterial({ color: 0x18181b });
            const shoeLeft = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.24), shoeMat);
            shoeLeft.position.set(-0.12, 0.06, -0.02);
            group.add(shoeLeft);

            const shoeRight = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.24), shoeMat);
            shoeRight.position.set(0.12, 0.06, -0.02);
            group.add(shoeRight);

            const legMat = new THREE.MeshLambertMaterial({ color: 0x27272a });
            const legLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.60, 12), legMat);
            legLeft.position.set(-0.12, 0.40, 0);
            group.add(legLeft);

            const legRight = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.60, 12), legMat);
            legRight.position.set(0.12, 0.40, 0);
            group.add(legRight);

            const bodyMat = new THREE.MeshLambertMaterial({ color: color });
            const torsoGeo = new THREE.CylinderGeometry(0.24, 0.22, 0.65, 16);
            const torso = new THREE.Mesh(torsoGeo, bodyMat);
            torso.position.y = 1.05;
            group.add(torso);

            const shoulderGeo = new THREE.SphereGeometry(0.24, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
            const shoulders = new THREE.Mesh(shoulderGeo, bodyMat);
            shoulders.position.y = 1.375;
            group.add(shoulders);

            const neckGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.10, 12);
            const neckMat = new THREE.MeshLambertMaterial({ color: 0x27272a });
            const neck = new THREE.Mesh(neckGeo, neckMat);
            neck.position.y = 1.48;
            group.add(neck);

            // Kopf exakt auf AugenhÃ¶he y = 1.70
            const headGeo = new THREE.SphereGeometry(0.20, 16, 16);
            const headMat = new THREE.MeshLambertMaterial({ color: color });
            const head = new THREE.Mesh(headGeo, headMat);
            head.position.y = 1.70;
            group.add(head);

            // Visier / Augen exakt bei y = 1.70
            const visorGeo = new THREE.BoxGeometry(0.20, 0.07, 0.10);
            const visorMat = new THREE.MeshBasicMaterial({ color: 0x09090b });
            const visor = new THREE.Mesh(visorGeo, visorMat);
            visor.position.set(0, 1.70, -0.17);
            group.add(visor);

            const nameTag = createNameTagSprite(nickname, color);
            nameTag.position.set(0, 2.15, 0);
            group.add(nameTag);

            const initY = typeof data.y === "number" ? Math.max(0, data.y - EYE_HEIGHT) : 0;
            const initX = typeof data.x === "number" ? data.x : 0;
            const initZ = typeof data.z === "number" ? data.z : 0;
            const initRot = typeof data.rotationY === "number" ? data.rotationY : 0;

            group.position.set(initX, initY, initZ);
            group.rotation.y = initRot;

            scene.add(group);

            remotePlayersMap.set(uid, {
                mesh: group,
                targetPos: new THREE.Vector3(initX, initY, initZ),
                targetRotY: initRot,
                nameTagSprite: nameTag,
                nickname: nickname,
                color: color
            });
        }

        function updateRemotePlayer(uid, data) {
            const player = remotePlayersMap.get(uid);
            if (!player) {
                addRemotePlayer(uid, data);
                return;
            }

            if (typeof data.x === "number" && typeof data.z === "number") {
                const targetY = typeof data.y === "number" ? Math.max(0, data.y - EYE_HEIGHT) : 0;
                player.targetPos.set(data.x, targetY, data.z);
            }
            if (typeof data.rotationY === "number") {
                player.targetRotY = data.rotationY;
            }

            if (data.isBike) {
                if (!player.remoteBike) {
                    player.remoteBike = createRemoteBikeModel();
                    player.remoteBike.position.set(0, 0, 0);
                    player.mesh.add(player.remoteBike);
                }
            } else if (player.remoteBike) {
                player.mesh.remove(player.remoteBike);
                disposeHierarchy(player.remoteBike);
                player.remoteBike = null;
            }

            if (data.isJetpack) {
                if (!player.remoteJetpack) {
                    player.remoteJetpack = createRemoteJetpackModel();
                    player.remoteJetpack.position.set(0, 1.15, 0.24);
                    player.mesh.add(player.remoteJetpack);
                }
                if (player.remoteJetpack && player.remoteJetpack.userData && player.remoteJetpack.userData.setFlamesVisible) {
                    const isFlying = Boolean(data.isFlying);
                    const flick = 0.85 + Math.random() * 0.35;
                    player.remoteJetpack.userData.setFlamesVisible(isFlying, flick);
                }
            } else if (player.remoteJetpack) {
                player.mesh.remove(player.remoteJetpack);
                disposeHierarchy(player.remoteJetpack);
                player.remoteJetpack = null;
            }

            if (data.nickname && data.nickname !== player.nickname) {
                player.nickname = data.nickname;
                if (player.nameTagSprite) {
                    player.mesh.remove(player.nameTagSprite);
                    if (player.nameTagSprite.material.map) player.nameTagSprite.material.map.dispose();
                    player.nameTagSprite.material.dispose();
                }
                const newTag = createNameTagSprite(data.nickname, data.color || player.color || getPlayerColor(uid));
                newTag.position.set(0, 2.15, 0);
                player.mesh.add(newTag);
                player.nameTagSprite = newTag;
            }
        }

        function removeRemotePlayer(uid) {
            const player = remotePlayersMap.get(uid);
            if (player) {
                scene.remove(player.mesh);
                disposeHierarchy(player.mesh);
                remotePlayersMap.delete(uid);
            }
        }

        function updatePlayerCountUI() {
            const el = document.getElementById("player-count-text");
            if (!el) return;
            const count = remotePlayersMap.size + (currentUser ? 1 : 0);
            el.textContent = count === 1 ? "1 online" : `${count} online`;
        }

        function startPlayerSync() {
            if (!currentUser) return;
            myPlayerRef = rtdbRef(rtdb, `players/${currentUser.uid}`);

            onDisconnect(myPlayerRef).remove().catch(err => console.warn("onDisconnect error:", err));

            const color = getPlayerColor(currentUser.uid);
            const nickname = getStoredNickname();

            const initCamDir = new THREE.Vector3();
            camera.getWorldDirection(initCamDir);
            const initYaw = Math.atan2(-initCamDir.x, -initCamDir.z);

            rtdbSet(myPlayerRef, {
                uid: currentUser.uid,
                email: currentUser.email || "Anonym",
                nickname: nickname,
                color: color,
                x: Number(playerPos.x.toFixed(3)),
                y: Number(playerPos.y.toFixed(3)),
                z: Number(playerPos.z.toFixed(3)),
                rotationY: Number(initYaw.toFixed(3)),
                isBike: Boolean(isRidingBike),
                isJetpack: Boolean(isJetpackEquipped),
                isFlying: Boolean(isJetpackEquipped && isJetpackThrusting),
                lastSeen: Date.now()
            }).catch(err => console.error("RTDB initial set error:", err));

            lastSent = {
                x: playerPos.x,
                y: playerPos.y,
                z: playerPos.z,
                rotY: initYaw
            };

            if (syncTimer) clearInterval(syncTimer);
            syncTimer = setInterval(() => {
                if (!controls || !controls.isLocked || !myPlayerRef) return;

                const curCamDir = new THREE.Vector3();
                camera.getWorldDirection(curCamDir);
                const curYaw = Math.atan2(-curCamDir.x, -curCamDir.z);

                const dx = Math.abs(playerPos.x - lastSent.x);
                const dy = Math.abs(playerPos.y - lastSent.y);
                const dz = Math.abs(playerPos.z - lastSent.z);
                const drot = Math.abs(curYaw - lastSent.rotY);

                if (dx > 0.015 || dz > 0.015 || dy > 0.015 || drot > 0.015) {
                    rtdbUpdate(myPlayerRef, {
                        x: Number(playerPos.x.toFixed(3)),
                        y: Number(playerPos.y.toFixed(3)),
                        z: Number(playerPos.z.toFixed(3)),
                        rotationY: Number(curYaw.toFixed(3)),
                        isBike: Boolean(isRidingBike),
                        isJetpack: Boolean(isJetpackEquipped),
                        isFlying: Boolean(isJetpackEquipped && isJetpackThrusting),
                        lastSeen: Date.now()
                    }).catch(() => {});

                    lastSent = {
                        x: playerPos.x,
                        y: playerPos.y,
                        z: playerPos.z,
                        rotY: curYaw
                    };
                }
            }, 60);

            updatePlayerCountUI();
        }

        function stopPlayerSync() {
            if (syncTimer) {
                clearInterval(syncTimer);
                syncTimer = null;
            }
            if (myPlayerRef) {
                rtdbRemove(myPlayerRef).catch(() => {});
                myPlayerRef = null;
            }
            remotePlayersMap.forEach((player) => {
                scene.remove(player.mesh);
                disposeHierarchy(player.mesh);
            });
            remotePlayersMap.clear();

            if (rtdbListeners && rtdbListeners.length > 0) {
                rtdbListeners.forEach(unsub => {
                    if (typeof unsub === "function") unsub();
                });
                rtdbListeners = [];
            }

            updatePlayerCountUI();
        }

        function subscribeToRemotePlayers() {
            const playersRef = rtdbRef(rtdb, "players");

            const unsubAdded = onChildAdded(playersRef, (snapshot) => {
                const uid = snapshot.key;
                if (!currentUser || uid === currentUser.uid) return;
                const data = snapshot.val();
                if (!data) return;
                addRemotePlayer(uid, data);
                updatePlayerCountUI();
            });

            const unsubChanged = onChildChanged(playersRef, (snapshot) => {
                const uid = snapshot.key;
                if (!currentUser || uid === currentUser.uid) return;
                const data = snapshot.val();
                if (!data) return;
                updateRemotePlayer(uid, data);
            });

            const unsubRemoved = onChildRemoved(playersRef, (snapshot) => {
                const uid = snapshot.key;
                removeRemotePlayer(uid);
                updatePlayerCountUI();
            });

            // Globalen Zustand der Chillen-Lampe & des Sternenhimmels fÃ¼r alle synchronisieren
            const worldLampRef = rtdbRef(rtdb, "worldState/chillenLamp");
            const unsubLamp = onValue(worldLampRef, (snapshot) => {
                const val = snapshot.val();
                if (val !== null && typeof val.isOn === "boolean") {
                    setChillenLampState(val.isOn, false);
                }
            });

            // Globalen Zustand des Cinema-Screens in Echtzeit abhÃ¶ren
            const worldCinemaRef = rtdbRef(rtdb, "worldState/cinema");
            const unsubCinema = onValue(worldCinemaRef, (snapshot) => {
                syncCinemaState(snapshot.val(), true);
            });

            // Globalen Zustand der Lagerstuehle in Echtzeit abhoeren
            const worldChairsRef = rtdbRef(rtdb, "worldState/warehouseChairs");
            const unsubChairs = onValue(worldChairsRef, (snapshot) => {
                const val = snapshot.val();
                if (val && typeof val === "object") {
                    syncWarehouseChairsFromNetwork(val);
                }
            });

            rtdbListeners = [unsubAdded, unsubChanged, unsubRemoved, unsubLamp, unsubCinema, unsubChairs];
        }

