// ============================================================================
// WorldManager.js — DER Singleton für Renderer, Szene, Kameras, Licht und
// Eingabe (Maus/Touch-Look, Gehen, Pinch-Zoom). Besitzt den einzigen
// THREE.WebGLRenderer; main.js reicht ihm pro Frame das aktive TrainModel.
//
// KI-LANDKARTE (wo bearbeite ich was):
//   - Kameras: cab/passenger/platform/orbit — Positionslogik pro Frame im
//     großen switch in update(dt, train3D). Look-Around-State: *Rotation/
//     *RotationView (geglättet via _smoothRotation, nur mobil).
//   - Licht/Umgebung: setupLights + updateEnvironmentLighting (Zonen-Targets
//     mit exponentiellem Nachziehen + Augen-Adaption via toneMappingExposure).
//     ACHTUNG: bewusst einfaches AmbientLight-Zonenmodell — aufwendigere
//     Konzepte (Hemisphäre, Punktlichter, Portal-Blending) wurden erprobt
//     und auf Nutzerwunsch VOLLSTÄNDIG zurückgebaut. Nicht wieder einführen.
//   - Eingabe: startLook/moveLook/endLook + onTouch*/onMouse*/onWheel/onKey*.
//     Radio-Klick-Raycast (nur Cab-View) in startLook.
//   - Fahrgast-Sprechblasen: handleSceneClick (Klick-Raycast auf Passagiere)
//     + Positions-Update am Ende von update().
//   - Auflösungs-Setting: setResolutionScale (Menü "Auflösung").
// HEISSER PFAD: update() läuft jeden Frame — ausschließlich die _wm*-Temps
// verwenden, keine new THREE.*-Allokationen einbauen.
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ITEM_SENTENCES } from './people/PassengerData.js';

// Reusable temp vectors for per-frame camera math (avoid GC churn)
const _wmPos = new THREE.Vector3();
const _wmTarget = new THREE.Vector3();
const _wmOffset = new THREE.Vector3();
const _wmQuat = new THREE.Quaternion();
const _wmEuler = new THREE.Euler();
const _wmLocal = new THREE.Vector3();
const _wmWorld = new THREE.Vector3();
const _wmDir = new THREE.Vector3();
const _wmFwd = new THREE.Vector3();
const _wmRight = new THREE.Vector3();
const _wmMove = new THREE.Vector3();
const _wmUp = new THREE.Vector3(0, 1, 0);
const _wmHeadPos = new THREE.Vector3();
const _wmHeadTarget = new THREE.Vector3();
const _wmFrustum = new THREE.Frustum();
const _wmProjM = new THREE.Matrix4();

export class WorldManager {
    constructor(containerEl, simulation) {
        this.container = containerEl;
        this.sim = simulation;
        
        // Core elements
        this.scene = null;
        this.renderer = null;
        this.controls = null;
        
        // Cameras
        this.activeCamera = null;
        this.cameras = {
            cab: null,
            passenger: null,
            platform: null,
            orbit: null
        };
        this.activeCameraType = 'cab'; // default cab view
        
        // Lights
        this.ambientLight = null;
        this.sunLight = null;
        this.headlight = null;
        
        // Sky & Env
        this.skyColor = new THREE.Color('#93d5f8'); // Day sky blue (fog tint; background uses skyTexture)
        this.tunnelColor = new THREE.Color('#000000'); // Pitch black tunnel
        this._isOpenAirBackground = null; // tracks which background is active (avoids Color/Texture .equals())
        
        // Eye adaptation effect: on a tunnel<->daylight change the exposure jumps to
        // adaptationFromExposure and settles back to 1.0 over adaptationDuration seconds.
        this.adaptationTimer = 0;
        this.adaptationActive = false;
        this.adaptationDuration = 1.0;
        this.adaptationFromExposure = 1.0;

        // Smooth lighting targets: instead of hard-assigning light intensities each frame,
        // we set targets and exponentially lerp toward them. This eliminates the visible
        // intensity jump when crossing a zone boundary (tunnel <-> station <-> open air).
        // _lightSpeed* controls how fast the lerp runs in each direction (s^-1):
        //   brightening (dark->light) is faster — like pupils constricting quickly in daylight
        //   darkening  (light->dark) is slower  — like pupils dilating slowly in the dark
        this._targetAmbient   = 0.6;
        this._targetSun       = 2.5;
        this._targetHeadlight = 1.0;
        this._targetFogDensity = 0.0015;
        this._lightSpeedBright = 6.0;  // s^-1 — fast brightening
        this._lightSpeedDark   = 2.5;  // s^-1 — slow darkening (pupil dilation)

        // Passenger camera rotation (look-around). Passenger spawns near the side wall
        // (x=-0.75, see passengerLocalPos below) - +PI/2 points the view across the car
        // towards the centre aisle/Gang instead of straight into the near wall (-PI/2).
        this.passengerRotation = { yaw: Math.PI / 2, pitch: 0 };
        this.passengerRotationView = { yaw: Math.PI / 2, pitch: 0 }; // smoothed value actually rendered
        this.isDraggingPassenger = false;

        // Cockpit camera rotation (look-around)
        this.cabRotation = { yaw: 0, pitch: 0 };
        this.cabRotationView = { yaw: 0, pitch: 0 }; // smoothed value actually rendered
        this.isDraggingCab = false;

        // Platform camera rotation (look-around) & drag state
        this.platformRotation = { yaw: 0, pitch: 0 };
        this.platformRotationView = { yaw: 0, pitch: 0 }; // smoothed value actually rendered
        this.isDraggingPlatform = false;
        this.platformCameraStationIdx = -1; // track active station for platform view

        // Orbit camera rotation & zoom (fixed chase camera)
        this.orbitRotation = { yaw: Math.PI / 4, pitch: Math.PI / 8 };
        this.orbitRotationView = { yaw: Math.PI / 4, pitch: Math.PI / 8 }; // smoothed value actually rendered
        this.orbitDistance = 40;
        this.isDraggingOrbit = false;

        // Two-finger pinch-to-zoom state (touch devices)
        this.pinchStartDist = null;
        this.pinchStartOrbitDistance = null;
        this.pinchStartFov = null;

        // Default FOV per camera, restored whenever the view is switched so a
        // pinch-zoom on one camera doesn't carry over to another
        this._defaultFov = { cab: 75, passenger: 65, platform: 55, orbit: 60 };

        // Analog walk input from the mobile joystick (x = strafe, y = forward), range -1..1
        this.mobileWalkInput = { x: 0, y: 0 };

        // Walking keys state
        this.keysPressed = {
            ArrowUp: false,
            ArrowDown: false,
            ArrowLeft: false,
            ArrowRight: false
        };

        this.previousMousePosition = { x: 0, y: 0 };
        this.passengerLocalPos = new THREE.Vector3(-0.8, 2.11, -9.0);
        this.passengerCarIdx = 1; // Default to 2nd carriage

        // Raycasting for interaction
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.train3D = null; // set each frame in update(); source of radio raycast targets

        this.init();
    }

    init() {
        // Scene setup
        this.scene = new THREE.Scene();
        this.scene.background = this.tunnelColor;
        this.scene.fog = new THREE.FogExp2(0x050505, 0.018); // Less dense tunnel fog

        // Renderer setup
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.resolutionScale = 1.0; // user quality setting, applied via setResolutionScale
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = false;
        // Filmic tone mapping: rolls over-bright sunlit areas off smoothly instead of
        // clipping each color channel at 1.0 (which washed colors out and shifted hues),
        // and is required for toneMappingExposure — the eye-adaptation flash below —
        // to have any effect at all (three.js ignores exposure under NoToneMapping).
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.container.appendChild(this.renderer.domElement);

        // Open-air sky: an equirectangular photo used directly as scene.background.
        // Three.js renders this as a full-screen shader (EquirectangularReflectionMapping),
        // so it costs no extra draw call or geometry — cheaper than the old per-chunk cloud
        // planes it replaces, and no more expensive than the flat sky color it also replaces.
        const skyUrl = new URL('../assets/sky.jpg', import.meta.url).href;
        this.skyTexture = new THREE.TextureLoader().load(skyUrl);
        this.skyTexture.mapping = THREE.EquirectangularReflectionMapping;
        this.skyTexture.colorSpace = THREE.SRGBColorSpace;

        // Cameras Setup
        const aspect = this.container.clientWidth / this.container.clientHeight;
        
        // 1. Cab Camera (inside front cabin)
        this.cameras.cab = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);

        // 2. Passenger Camera (inside passenger coach looking out window)
        this.cameras.passenger = new THREE.PerspectiveCamera(65, aspect, 0.1, 1000);

        // 3. Platform Camera (cinematic angle at next station)
        this.cameras.platform = new THREE.PerspectiveCamera(55, aspect, 0.1, 1000);

        // 4. Orbit Camera (general view)
        this.cameras.orbit = new THREE.PerspectiveCamera(60, aspect, 0.1, 15000);

        // Orbit Controls
        this.controls = new OrbitControls(this.cameras.orbit, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.05; // don't go below ground
        this.controls.minDistance = 5;
        this.controls.maxDistance = 5000;
        
        // Set orbit camera initial position relative to train
        this.cameras.orbit.position.set(20, 15, 30);
        this.controls.target.set(0, 2, 0);
        this.controls.update();

        this.activeCamera = this.cameras.cab;
        this.controls.enabled = false;

        // Lighting
        this.setupLights();



        // Resize Listener
        window.addEventListener('resize', this.onWindowResize.bind(this));

        // Setup mouse & touch listeners for passenger, cockpit, platform & orbit look-around
        this.startLook = (clientX, clientY) => {
            // Raycasting for radio interaction (only in cab view). Only test the few
            // radio meshes instead of the whole scene graph — a full recursive scene
            // raycast caused a noticeable hitch on every click/touch.
            if (this.activeCameraType === 'cab' && this.train3D && this.train3D.radioMeshes.length > 0) {
                this.mouse.x = (clientX / window.innerWidth) * 2 - 1;
                this.mouse.y = -(clientY / window.innerHeight) * 2 + 1;
                this.raycaster.setFromCamera(this.mouse, this.activeCamera);
                const intersects = this.raycaster.intersectObjects(this.train3D.radioMeshes, false);
                if (intersects.length > 0) {
                    const uv = intersects[0].uv;
                    // Small "Aus" button drawn in the screen's top-right corner (see
                    // TrainModel.drawRadioDisplay) - top-right in canvas space is
                    // uv.x > 0.75 / uv.y > 0.7 (PlaneGeometry v=1 is the top edge).
                    const hitOffButton = uv && uv.x > 0.75 && uv.y > 0.7;
                    if (!this.sim.radioActive) {
                        this.sim.wantsRadioPlay = true; // turn on: always starts on the default station
                    } else if (hitOffButton) {
                        this.sim.wantsRadioOff = true;
                    } else {
                        this.sim.wantsRadioNext = true; // any other click: next station
                    }
                }
            }

            if (this.activeCameraType === 'passenger') {
                this.isDraggingPassenger = true;
            } else if (this.activeCameraType === 'cab') {
                this.isDraggingCab = true;
            } else if (this.activeCameraType === 'platform') {
                this.isDraggingPlatform = true;
            } else if (this.activeCameraType === 'orbit') {
                this.isDraggingOrbit = true;
            }
            this.previousMousePosition = { x: clientX, y: clientY };
        };

        this.moveLook = (clientX, clientY, isTouch = false) => {
            // Touch drags cover much less screen distance per look-around gesture than a
            // mouse swipe does, so at the same sensitivity mobile felt sluggish. Boost it
            // for touch input only — desktop mouse-look is untouched.
            const sens = isTouch ? 0.0075 : 0.003;
            if (this.isDraggingPassenger && this.activeCameraType === 'passenger') {
                const deltaX = clientX - this.previousMousePosition.x;
                const deltaY = clientY - this.previousMousePosition.y;

                this.passengerRotation.yaw -= deltaX * sens;
                this.passengerRotation.pitch -= deltaY * sens;

                // Clamp pitch to look up/down without flipping (-85deg to +85deg)
                const limit = Math.PI / 2 - 0.05;
                this.passengerRotation.pitch = Math.max(-limit, Math.min(limit, this.passengerRotation.pitch));

                this.previousMousePosition = { x: clientX, y: clientY };
            } else if (this.isDraggingCab && this.activeCameraType === 'cab') {
                const deltaX = clientX - this.previousMousePosition.x;
                const deltaY = clientY - this.previousMousePosition.y;

                this.cabRotation.yaw -= deltaX * sens;
                this.cabRotation.pitch -= deltaY * sens;

                // Clamp pitch to look up/down without flipping (-85deg to +85deg)
                const limit = Math.PI / 2 - 0.05;
                this.cabRotation.pitch = Math.max(-limit, Math.min(limit, this.cabRotation.pitch));

                this.previousMousePosition = { x: clientX, y: clientY };
            } else if (this.isDraggingPlatform && this.activeCameraType === 'platform') {
                const deltaX = clientX - this.previousMousePosition.x;
                const deltaY = clientY - this.previousMousePosition.y;

                this.platformRotation.yaw -= deltaX * sens;
                this.platformRotation.pitch -= deltaY * sens;

                // Clamp pitch to look up/down without flipping (-85deg to +85deg)
                const limit = Math.PI / 2 - 0.05;
                this.platformRotation.pitch = Math.max(-limit, Math.min(limit, this.platformRotation.pitch));

                this.previousMousePosition = { x: clientX, y: clientY };
            } else if (this.isDraggingOrbit && this.activeCameraType === 'orbit') {
                const deltaX = clientX - this.previousMousePosition.x;
                const deltaY = clientY - this.previousMousePosition.y;

                this.orbitRotation.yaw -= deltaX * sens;
                this.orbitRotation.pitch += deltaY * sens; // inverted Y for orbit feels more natural

                // Clamp pitch to avoid flipping
                const limit = Math.PI / 2 - 0.05;
                this.orbitRotation.pitch = Math.max(-limit, Math.min(limit, this.orbitRotation.pitch));

                this.previousMousePosition = { x: clientX, y: clientY };
            }
        };

        this.endLook = () => {
            this.isDraggingPassenger = false;
            this.isDraggingCab = false;
            this.isDraggingPlatform = false;
            this.isDraggingOrbit = false;
        };

        this.onMouseDown = (e) => {
            if (e.button === 0) {
                this.startLook(e.clientX, e.clientY);
                this.clickStartPos = { x: e.clientX, y: e.clientY };
            }
        };

        this.onMouseMove = (e) => {
            this.moveLook(e.clientX, e.clientY);
        };

        this.onMouseUp = (e) => {
            if (e.button === 0) {
                this.endLook();
                if (this.clickStartPos) {
                    const dx = e.clientX - this.clickStartPos.x;
                    const dy = e.clientY - this.clickStartPos.y;
                    if (Math.hypot(dx, dy) < 16) {
                        this.handleSceneClick(e);
                    }
                    this.clickStartPos = null;
                }
            }
        };

        // Touch equivalents (single-finger look-around, two-finger pinch-to-zoom)
        this.onTouchStart = (e) => {
            if (e.touches.length === 1) {
                const t = e.touches[0];
                this.startLook(t.clientX, t.clientY);
                this.touchStartPos = { x: t.clientX, y: t.clientY };
            } else if (e.touches.length === 2) {
                // A second finger landed: cancel any single-finger look-drag and
                // start tracking pinch distance instead.
                this.endLook();
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                this.pinchStartDist = Math.hypot(dx, dy);
                this.pinchStartOrbitDistance = this.orbitDistance;
                this.pinchStartFov = this.activeCamera.fov;
            }
        };

        this.onTouchMove = (e) => {
            if (e.touches.length === 1 && (this.isDraggingPassenger || this.isDraggingCab || this.isDraggingPlatform || this.isDraggingOrbit)) {
                e.preventDefault(); // avoid page scroll/rubber-banding while looking around
                const t = e.touches[0];
                this.moveLook(t.clientX, t.clientY, true);
            } else if (e.touches.length === 2 && this.pinchStartDist) {
                e.preventDefault();
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.hypot(dx, dy);
                const ratio = this.pinchStartDist / Math.max(1, dist); // fingers apart -> ratio < 1 -> zoom in

                if (this.activeCameraType === 'orbit') {
                    this.orbitDistance = Math.max(5, Math.min(5000, this.pinchStartOrbitDistance * ratio));
                } else {
                    this.activeCamera.fov = Math.max(30, Math.min(90, this.pinchStartFov * ratio));
                    this.activeCamera.updateProjectionMatrix();
                }
            }
        };

        this.onTouchEnd = (e) => {
            if (e.touches.length < 2) {
                this.pinchStartDist = null;
            }
            if (e.touches.length === 0) {
                this.endLook();
                if (this.touchStartPos) {
                    const t = e.changedTouches ? e.changedTouches[0] : null;
                    if (t) {
                        const dx = t.clientX - this.touchStartPos.x;
                        const dy = t.clientY - this.touchStartPos.y;
                        if (Math.hypot(dx, dy) < 25) {
                            this.handleSceneClick({ clientX: t.clientX, clientY: t.clientY });
                        }
                    }
                    this.touchStartPos = null;
                }
            }
        };

        this.onWheel = (e) => {
            if (this.activeCameraType === 'orbit') {
                this.orbitDistance += e.deltaY * 0.05;
                this.orbitDistance = Math.max(5, Math.min(5000, this.orbitDistance));
            } else if (this.activeCameraType === 'cab' || this.activeCameraType === 'passenger' || this.activeCameraType === 'platform') {
                const cam = this.cameras[this.activeCameraType];
                cam.fov += e.deltaY * 0.05;
                cam.fov = Math.max(30, Math.min(90, cam.fov));
                cam.updateProjectionMatrix();
            }
        };

        this.onKeyDown = (e) => {
            if ((this.activeCameraType === 'platform' || this.activeCameraType === 'passenger') && e.key in this.keysPressed) {
                this.keysPressed[e.key] = true;
                e.preventDefault(); // prevent page scroll
            }
        };

        this.onKeyUp = (e) => {
            if (e.key in this.keysPressed) {
                this.keysPressed[e.key] = false;
            }
        };

        // Footstep tracking
        this.footstepDistance = 0;
        this.onFootstep = null; // Callback

        // Programmatic retro speech bubble overlay
        const bubble = document.createElement('div');
        bubble.id = 'passenger-bubble';
        bubble.style.position = 'absolute';
        bubble.style.display = 'none';
        bubble.style.backgroundColor = '#ffffff';
        bubble.style.color = '#000000';
        bubble.style.padding = '8px 12px';
        bubble.style.border = '2px solid #000000';
        bubble.style.fontFamily = 'monospace';
        bubble.style.fontSize = '13px';
        bubble.style.zIndex = '1000';
        bubble.style.pointerEvents = 'none';
        bubble.style.maxWidth = '250px';
        bubble.style.boxShadow = '4px 4px 0px rgba(0,0,0,0.15)';
        bubble.style.borderRadius = '0px';

        const nameEl = document.createElement('div');
        nameEl.id = 'bubble-name';
        nameEl.style.fontWeight = 'bold';
        nameEl.style.marginBottom = '4px';
        bubble.appendChild(nameEl);

        const textEl = document.createElement('div');
        textEl.id = 'bubble-text';
        bubble.appendChild(textEl);

        // Progress loader bar
        const loader = document.createElement('div');
        loader.id = 'bubble-loader';
        loader.style.display = 'block';
        loader.style.height = '4px';
        loader.style.backgroundColor = '#000000';
        loader.style.width = '100%';
        loader.style.marginTop = '8px';
        loader.style.transformOrigin = 'left center';
        loader.style.transform = 'scaleX(1)';
        bubble.appendChild(loader);
        this.speechBubbleLoader = loader;
        this.bubbleTimeout = null;

        document.getElementById('viewport-container').appendChild(bubble);
        this.speechBubble = bubble;
        this.activePassengerForBubble = null;

        this.container.addEventListener('mousedown', this.onMouseDown);
        window.addEventListener('mousemove', this.onMouseMove);
        window.addEventListener('mouseup', this.onMouseUp);
        this.container.addEventListener('touchstart', this.onTouchStart, { passive: true });
        window.addEventListener('touchmove', this.onTouchMove, { passive: false });
        window.addEventListener('touchend', this.onTouchEnd);
        window.addEventListener('touchcancel', this.onTouchEnd);
        window.addEventListener('wheel', this.onWheel, { passive: true });
        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('keyup', this.onKeyUp);
    }

    handleSceneClick(e) {
        // Calculate mouse position in normalized device coordinates relative to the canvas bounding rect
        const rect = this.renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1
        );

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, this.activeCamera);

        // Collect all active passenger groups in the scene
        const passengers = [];
        this.scene.traverse(child => {
            if (child.userData && child.userData.isPassenger) {
                passengers.push(child);
            }
        });

        // Raycast ONLY against passenger groups to avoid any interference/blocking by other meshes (like train carriages or platform structures)
        const intersects = raycaster.intersectObjects(passengers, true);

        let clickedPassenger = null;
        if (intersects.length > 0) {
            let current = intersects[0].object;
            while (current) {
                if (current.userData && current.userData.isPassenger) {
                    clickedPassenger = current;
                    break;
                }
                current = current.parent;
            }
        }

        if (clickedPassenger) {
            const config = clickedPassenger.userData.config;
            const name = config.name || "Fahrgast";
            const item = config.item || "";
            const sentence = ITEM_SENTENCES[item] || "Hallo! Schöner Tag heute.";

            document.getElementById('bubble-name').innerText = name;
            document.getElementById('bubble-text').innerText = sentence;
            this.activePassengerForBubble = clickedPassenger;

            // Make the speech bubble immediately display block to allow layout transitions
            this.speechBubble.style.display = 'block';

            // Clear previous timeout if any
            if (this.bubbleTimeout) {
                clearTimeout(this.bubbleTimeout);
                this.bubbleTimeout = null;
            }

            // Reset loading bar scale and remove transition
            this.speechBubbleLoader.style.transition = 'none';
            this.speechBubbleLoader.style.transform = 'scaleX(1)';
            
            // Force reflow so the browser registers the scaleX(1) state instantly
            void this.speechBubbleLoader.offsetWidth;

            // Start CSS transition to scale down to 0 over 7 seconds
            this.speechBubbleLoader.style.transition = 'transform 7s linear';
            this.speechBubbleLoader.style.transform = 'scaleX(0)';

            // Set timeout to automatically close the bubble after 7 seconds
            this.bubbleTimeout = setTimeout(() => {
                this.activePassengerForBubble = null;
                this.bubbleTimeout = null;
            }, 7000);
        } else {
            this.activePassengerForBubble = null;
            if (this.bubbleTimeout) {
                clearTimeout(this.bubbleTimeout);
                this.bubbleTimeout = null;
            }
        }
    }

    setupLights() {
        // Ambient Light
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6); // Brighter ambient daylight
        this.scene.add(this.ambientLight);

        // Sun light (for open air areas, disabled in tunnels)
        this.sunLight = new THREE.DirectionalLight(0xffffff, 2.5); // Bright white sunlight
        this.sunLight.position.set(-100, 150, 50); // Sun higher up
        this.scene.add(this.sunLight);

        // Train Headlight (spotlight attached to the front of the train)
        this.headlight = new THREE.SpotLight(0xffffff, 15.0, 80, Math.PI / 4.5, 0.8, 1.0);
        this.scene.add(this.headlight);
        this.scene.add(this.headlight.target); // Spotlight needs target in scene
    }

    setCamera(type) {
        if (this.cameras[type]) {
            this.activeCameraType = type;
            this.activeCamera = this.cameras[type];

            // Reset FOV so a pinch-zoom on one view doesn't carry over to another
            if (this._defaultFov[type] !== undefined) {
                this.cameras[type].fov = this._defaultFov[type];
                this.cameras[type].updateProjectionMatrix();
            }

            // OrbitControls are disabled as we now use a custom fixed chase camera logic
            this.controls.enabled = false;

            if (type === 'platform') {
                this.platformCameraStationIdx = -1; // force reset position/look direction on next frame
            }
        }
    }

    // Analog walk input from the mobile joystick, x = strafe (-1 left..1 right),
    // y = forward (-1 back..1 fwd). Combined additively with the arrow-key input
    // in the passenger/platform walking logic below.
    setMobileWalkInput(x, y) {
        this.mobileWalkInput.x = x;
        this.mobileWalkInput.y = y;
    }

    // Frame-rate independent exponential smoothing of a look-around yaw/pitch target
    // into the value actually used for rendering, so touch-drag jitter doesn't
    // translate directly into a jerky camera.
    _smoothRotation(view, target, dt, speed = 14) {
        // Only smooth on mobile (touch drag benefits from it); desktop keeps the
        // original instant 1:1 response.
        if (!document.body.classList.contains('is-mobile')) {
            view.yaw = target.yaw;
            view.pitch = target.pitch;
            return;
        }
        const t = 1 - Math.exp(-dt * speed);
        view.yaw += (target.yaw - view.yaw) * t;
        view.pitch += (target.pitch - view.pitch) * t;
    }

    // Render-resolution quality setting: scales the device pixel ratio (1.0 / 0.75 / 0.5).
    // Lower scales render far fewer fragments — the biggest GPU lever on high-DPI screens.
    setResolutionScale(scale) {
        this.resolutionScale = scale;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * scale);
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }

    onWindowResize() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        const aspect = width / height;

        for (const camName in this.cameras) {
            this.cameras[camName].aspect = aspect;
            this.cameras[camName].updateProjectionMatrix();
        }

        this.renderer.setSize(width, height);
    }

    update(dt, train3D) {
        if (!train3D) return;
        this.train3D = train3D;

        // Get train coordinates
        const trainZ = this.sim.position;
        const direction = this.sim.isReversing ? -1 : 1;
        const isG1 = (this.sim.trainModelType === 'G1');
        const isDT3 = (this.sim.trainModelType === 'DT3');
        const isDT1 = (this.sim.trainModelType === 'DT1');
        const trainLength = isG1 ? 76.170 : (isDT3 ? 38.085 : 75.5); // 1:1 – volle Zuglänge in Metern
        
        // Train front is at trainZ, rear is at trainZ - direction * trainLength
        const frontZ = trainZ;
        const rearZ = trainZ - direction * trainLength;
        const centerZ = trainZ - direction * (trainLength / 2);

        // Update lighting based on environment (tunnel vs open-air)
        this.updateEnvironmentLighting(trainZ, dt);

        // Update headlight position (always at the front of the train, relative to active leading carriage)
        const activeCabCar = train3D.carriages[this.sim.isReversing ? (train3D.carriages.length - 1) : 0];
        const activeCarLength = isG1 ? 19.270 : (isDT3 ? 19.0425 : 18.575);
        
        const headLocalPos = this.sim.isReversing ? _wmHeadPos.set(0, 1.2, -activeCarLength - 0.5) : _wmHeadPos.set(0, 1.2, 0.5);
        const headLocalTarget = this.sim.isReversing ? _wmHeadTarget.set(0, 0.2, -40.5) : _wmHeadTarget.set(0, 0.2, 40.5);
        this.headlight.position.copy(activeCabCar.localToWorld(headLocalPos));
        this.headlight.target.position.copy(activeCabCar.localToWorld(headLocalTarget));

        // Update camera position depending on active mode
        switch (this.activeCameraType) {
            case 'cab': {
                // Driver's perspective inside the active leading carriage
                const cabOffset = isDT1 ? 1.2 : 1.1;
                const cabLocalPos = this.sim.isReversing ? _wmLocal.set(0, 2.00, -activeCarLength + cabOffset) : _wmLocal.set(0, 2.00, -cabOffset);

                // Calculate local direction vector with relative yaw/pitch (smoothed
                // towards the touch/mouse-driven target so drag jitter isn't jarring)
                this._smoothRotation(this.cabRotationView, this.cabRotation, dt);
                const defaultYaw = this.sim.isReversing ? Math.PI : 0;
                const yaw = defaultYaw + this.cabRotationView.yaw;
                const pitch = this.cabRotationView.pitch;

                const localDir = _wmDir.set(
                    Math.sin(yaw) * Math.cos(pitch),
                    Math.sin(pitch),
                    Math.cos(yaw) * Math.cos(pitch)
                );

                const localTarget = _wmTarget.copy(cabLocalPos).add(localDir);

                const worldPos = activeCabCar.localToWorld(_wmWorld.copy(cabLocalPos));
                const worldTarget = activeCabCar.localToWorld(localTarget);

                this.cameras.cab.position.copy(worldPos);
                this.cameras.cab.lookAt(worldTarget);
                break;
            }
                
            case 'passenger': {
                // Passenger standing inside the train (height 70% of floor-to-ceiling distance)
                const passCar = train3D.carriages[this.passengerCarIdx];

                // Handle walking inside the carriage (arrow keys and/or mobile joystick)
                this._smoothRotation(this.passengerRotationView, this.passengerRotation, dt);
                const walkSpeed = 4.5 * dt; // Brisk walking speed inside the train
                const yaw = this.passengerRotationView.yaw;
                const forward = _wmFwd.set(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
                const right = _wmRight.crossVectors(forward, _wmUp).normalize();

                const moveVec = _wmMove.set(0, 0, 0);
                if (this.keysPressed.ArrowUp) moveVec.add(forward);
                if (this.keysPressed.ArrowDown) moveVec.sub(forward);
                if (this.keysPressed.ArrowRight) moveVec.add(right);
                if (this.keysPressed.ArrowLeft) moveVec.sub(right);
                if (moveVec.lengthSq() > 1) moveVec.normalize();

                moveVec.addScaledVector(forward, this.mobileWalkInput.y);
                moveVec.addScaledVector(right, this.mobileWalkInput.x);
                if (moveVec.lengthSq() > 1) moveVec.normalize();

                if (moveVec.lengthSq() > 0.0001) {
                    moveVec.multiplyScalar(walkSpeed);
                    const moveLen = moveVec.length();
                    this.passengerLocalPos.add(moveVec);

                    // Footstep sound triggering (slower, more intense)
                    this.footstepDistance += moveLen;
                    if (this.footstepDistance > 1.4) {
                        if (this.onFootstep) this.onFootstep(0.12);
                        this.footstepDistance = 0;
                    }
                }

                // Carriage switching logic (walk between wagons)
                const lastCarIdx = train3D.carriages.length - 1;
                if (this.passengerLocalPos.z > 0 && this.passengerCarIdx > 0) {
                    this.passengerCarIdx--;
                    this.passengerLocalPos.z -= 19;
                } else if (this.passengerLocalPos.z < -19 && this.passengerCarIdx < lastCarIdx) {
                    this.passengerCarIdx++;
                    this.passengerLocalPos.z += 19;
                }
                
                // Clamp passenger to coach interior space:
                // Width is 2.18m (Passage between carriages is ~1.68m wide)
                this.passengerLocalPos.x = Math.max(-0.75, Math.min(0.75, this.passengerLocalPos.x));

                // Length clamping (entire train from front cockpit to rear cockpit)
                const isDT3 = (this.sim.trainModelType === 'DT3');
                const cabLen = isDT3 ? 0.35 : (isG1 ? 1.9 : 1.44);
                let minZ = -19;
                let maxZ = 0;
                if (this.passengerCarIdx === 0) maxZ = -(cabLen + 0.05); // don't clip into front cab/window
                if (this.passengerCarIdx === lastCarIdx) minZ = -19 + (cabLen + 0.05); // don't clip into rear cab/window

                this.passengerLocalPos.z = Math.max(minZ, Math.min(maxZ, this.passengerLocalPos.z));

                // Camera height set to local height of 2.11m (aligned with windows in scaled coordinate space)
                this.passengerLocalPos.y = 2.11;

                // Final carriage reference for world transform
                const currentCar = train3D.carriages[this.passengerCarIdx];

                // Calculate local direction vector from passenger yaw/pitch
                const localDir = _wmDir.set(
                    Math.sin(yaw) * Math.cos(this.passengerRotationView.pitch),
                    Math.sin(this.passengerRotationView.pitch),
                    Math.cos(yaw) * Math.cos(this.passengerRotationView.pitch)
                );

                const localTarget = _wmTarget.copy(this.passengerLocalPos).add(localDir);
                const worldPos = currentCar.localToWorld(_wmWorld.copy(this.passengerLocalPos));
                const worldTarget = currentCar.localToWorld(localTarget);

                this.cameras.passenger.position.copy(worldPos);
                this.cameras.passenger.lookAt(worldTarget);
                break;
            }
                
            case 'platform': {
                // Determine which station to focus the platform camera on
                const currentStation = this.sim.stations[this.sim.currentStationIdx];
                const nextStation = this.sim.stations[this.sim.nextStationIdx];
                const distToNext = Math.abs(trainZ - nextStation.position);
                
                // Focus on next station if we are close (within 120m), otherwise focus on the station we just left
                const targetStation = (distToNext < 120) ? nextStation : currentStation;
                
                // If the target station has changed, reset the platform camera position
                if (this.platformCameraStationIdx !== targetStation.index) {
                    this.platformCameraStationIdx = targetStation.index;
                    
                    const direction = this.sim.isReversing ? -1 : 1;
                    const camZ = targetStation.position - direction * 20.0;
                    const statPos = this.sim.getTrackPosition(camZ);
                    const statTangent = this.sim.getTrackTangent(camZ);
                    const statNormal = new THREE.Vector3(-statTangent.z, 0, statTangent.x);
                    
                    const isSideStation = targetStation && targetStation.side;
                    const isScharfreiterring = targetStation && (targetStation.name === "Scharfreiterring");
                    const isPlaerrer = targetStation && (targetStation.name === "Plärrer");
                    const spacing = this.sim.getTrackSpacing(camZ);
                    const trainXOffset = this.sim.isReversing ? (-spacing / 2) : (spacing / 2);
                    
                    let localX;
                    if (isPlaerrer) {
                        localX = -5.0;
                    } else if (isScharfreiterring) {
                        localX = trainXOffset - Math.sign(trainXOffset) * 2.58;
                    } else if (isSideStation) {
                        localX = trainXOffset + Math.sign(trainXOffset) * 2.8;
                    } else {
                        localX = trainXOffset - Math.sign(trainXOffset) * 2.50;
                    }
                    
                    const levelY = this.sim.getTrackElevationOffset(camZ, this.sim.isReversing);

                    const defaultPos = statPos.clone().addScaledVector(statNormal, localX);
                    defaultPos.y = statPos.y + levelY + 2.575;
                    
                    this.cameras.platform.position.copy(defaultPos);
                    
                    // Point camera at the train's cab
                    const trainCabinLocalPos = this.sim.isReversing ? new THREE.Vector3(0, 1.2, -activeCarLength) : new THREE.Vector3(0, 1.2, 0.0);
                    const trainWorldPos = activeCabCar.localToWorld(trainCabinLocalPos);
                    const dir = new THREE.Vector3().subVectors(trainWorldPos, defaultPos).normalize();
                    
                    this.platformRotation.yaw = Math.atan2(dir.x, dir.z);
                    this.platformRotation.pitch = Math.asin(dir.y);
                    // Snap the smoothed view too so switching stations doesn't slew the camera
                    this.platformRotationView.yaw = this.platformRotation.yaw;
                    this.platformRotationView.pitch = this.platformRotation.pitch;
                }

                this._smoothRotation(this.platformRotationView, this.platformRotation, dt);

                // Handle walking on the platform (WASD are for train, arrow keys and/or
                // mobile joystick for camera walking)
                const walkSpeed = 5.0 * dt; // 5 m/s walking speed
                const yaw = this.platformRotationView.yaw;
                const forward = _wmFwd.set(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
                const right = _wmRight.crossVectors(forward, _wmUp).normalize();

                const moveVec = _wmMove.set(0, 0, 0);
                if (this.keysPressed.ArrowUp) moveVec.add(forward);
                if (this.keysPressed.ArrowDown) moveVec.sub(forward);
                if (this.keysPressed.ArrowRight) moveVec.add(right);
                if (this.keysPressed.ArrowLeft) moveVec.sub(right);
                if (moveVec.lengthSq() > 1) moveVec.normalize();

                moveVec.addScaledVector(forward, this.mobileWalkInput.y);
                moveVec.addScaledVector(right, this.mobileWalkInput.x);
                if (moveVec.lengthSq() > 1) moveVec.normalize();

                if (moveVec.lengthSq() > 0.0001) {
                    moveVec.multiplyScalar(walkSpeed);
                    const moveLen = moveVec.length();
                    this.cameras.platform.position.add(moveVec);

                    // Footstep sound triggering (slower, more intense)
                    this.footstepDistance += moveLen;
                    if (this.footstepDistance > 2.2) {
                        if (this.onFootstep) this.onFootstep(0.25);
                        this.footstepDistance = 0;
                    }
                }

                // Ensure Y stays at exactly platform eye level relative to the station track elevation
                const plLevelY = this.sim.getTrackElevationOffset(targetStation.position, this.sim.isReversing);
                const stationY = this.sim.getTrackPosition(targetStation.position, _wmPos).y;
                this.cameras.platform.position.y = stationY + plLevelY + 2.575;

                // Compute look direction from yaw/pitch
                const lookDir = _wmDir.set(
                    Math.sin(yaw) * Math.cos(this.platformRotationView.pitch),
                    Math.sin(this.platformRotationView.pitch),
                    Math.cos(yaw) * Math.cos(this.platformRotationView.pitch)
                );

                const targetPos = _wmTarget.copy(this.cameras.platform.position).add(lookDir);
                this.cameras.platform.lookAt(targetPos);
                break;
            }
                
            case 'orbit': {
                // Chase camera orbiting around the cockpit (leading cab), not the whole
                // train's centre.
                const activeCabCar = train3D.carriages[this.sim.isReversing ? (train3D.carriages.length - 1) : 0];
                const activeCarLength = isG1 ? 19.270 : (isDT3 ? 19.0425 : 19.0);
                const cabLocalPos = this.sim.isReversing ? _wmLocal.set(0, 2.00, -activeCarLength + 1.1) : _wmLocal.set(0, 2.00, -1.1);

                // Target is exactly the driver's head position in the world
                const targetPos = activeCabCar.localToWorld(_wmWorld.copy(cabLocalPos));

                // Use actual carriage yaw instead of track tangent for a more stable chase effect
                const carWorldQuaternion = _wmQuat.setFromRotationMatrix(activeCabCar.matrixWorld);
                const carEuler = _wmEuler.setFromQuaternion(carWorldQuaternion, 'YXZ');
                const trainYaw = carEuler.y + (this.sim.isReversing ? Math.PI : 0);

                // Calculate camera position relative to train center and orientation
                this._smoothRotation(this.orbitRotationView, this.orbitRotation, dt);
                const yaw = trainYaw + this.orbitRotationView.yaw;
                const pitch = this.orbitRotationView.pitch;

                const offset = _wmOffset.set(
                    Math.sin(yaw) * Math.cos(pitch),
                    Math.sin(pitch),
                    Math.cos(yaw) * Math.cos(pitch)
                ).multiplyScalar(this.orbitDistance);

                this.cameras.orbit.position.copy(targetPos).add(offset);

                // Prevent camera from falling below track level (using track sample only for ground ref)
                this.sim._sampleTrack(trainZ, _wmPos, null);
                const groundY = _wmPos.y + 0.5;
                if (this.cameras.orbit.position.y < groundY) {
                    this.cameras.orbit.position.y = groundY;
                }

                this.cameras.orbit.lookAt(targetPos);
                break;
            }
        }

        // Planar mirror pass for the interior window reflections. Only for
        // in-train cameras (exterior views keep the static cubemap and this
        // costs nothing); skipped on mobile for performance.
        const interiorCam = this.activeCameraType === 'cab' || this.activeCameraType === 'passenger';
        train3D.updatePlanarReflections(
            this.renderer,
            this.activeCamera,
            interiorCam && !document.body.classList.contains('is-mobile')
        );

        // Apply render
        this.renderer.render(this.scene, this.activeCamera);

        // Update speech bubble position
        if (this.activePassengerForBubble) {
            // Check if passenger is still in the active scene hierarchy (i.e. not culled or removed)
            let parent = this.activePassengerForBubble.parent;
            let inScene = false;
            while (parent) {
                if (parent === this.scene) {
                    inScene = true;
                    break;
                }
                parent = parent.parent;
            }

            if (!inScene) {
                this.activePassengerForBubble = null;
                if (this.bubbleTimeout) {
                    clearTimeout(this.bubbleTimeout);
                    this.bubbleTimeout = null;
                }
                if (this.speechBubble) {
                    this.speechBubble.style.display = 'none';
                }
            } else {
                const headWorldPos = this.activePassengerForBubble.getWorldPosition(_wmWorld);
                // Height offset to place bubble above passenger head (approx 1.8m in world space)
                headWorldPos.y += 1.8;

                // Check if behind camera (using world coordinates before projecting)
                _wmProjM.multiplyMatrices(this.activeCamera.projectionMatrix, this.activeCamera.matrixWorldInverse);
                _wmFrustum.setFromProjectionMatrix(_wmProjM);
                const isVisible = _wmFrustum.containsPoint(headWorldPos);

                // Project 3D coordinate to 2D screen coordinate
                headWorldPos.project(this.activeCamera);

                if (isVisible) {
                    // Convert projected coords to CSS pixels
                    const x = (headWorldPos.x * 0.5 + 0.5) * this.container.clientWidth;
                    const y = (-(headWorldPos.y * 0.5) + 0.5) * this.container.clientHeight;

                    this.speechBubble.style.display = 'block';
                    this.speechBubble.style.left = `${x - this.speechBubble.clientWidth / 2}px`;
                    this.speechBubble.style.top = `${y - this.speechBubble.clientHeight - 10}px`;
                } else {
                    this.speechBubble.style.display = 'none';
                }
            }
        } else {
            if (this.speechBubble) {
                this.speechBubble.style.display = 'none';
            }
        }
    }
    updateEnvironmentLighting(trainZ, dt) {
        const direction = this.sim.isReversing ? -1 : 1;
        let cameraTrackZ = trainZ;

        if (this.activeCameraType === 'platform') {
            const currentStation = this.sim.stations[this.sim.currentStationIdx];
            const nextStation = this.sim.stations[this.sim.nextStationIdx];
            const distToNext = Math.abs(trainZ - nextStation.position);
            const targetStation = (distToNext < 120) ? nextStation : currentStation;
            cameraTrackZ = targetStation.position;
        } else if (this.activeCameraType === 'passenger' || this.activeCameraType === 'orbit') {
            cameraTrackZ = trainZ - direction * 19;
        }

        const chunkType = this.getChunkTypeAtDistance(cameraTrackZ);
        const isOpenAir = (chunkType !== 'underground');
        const isPlatform = this.isInsideStationPlatform(cameraTrackZ);

        // Handle eye adaptation effect when transitioning
        if (isOpenAir && this._isOpenAirBackground === false) {
            // Emerging from tunnel: daylight blinds for a moment, eyes settle quickly
            this.adaptationActive = true;
            this.adaptationTimer = 0;
            this.adaptationDuration = 1.4;
            this.adaptationFromExposure = 2.0;
        } else if (!isOpenAir && this._isOpenAirBackground === true) {
            // Entering tunnel: near-black at first, dark adaptation takes longer
            this.adaptationActive = true;
            this.adaptationTimer = 0;
            this.adaptationDuration = 2.2;
            this.adaptationFromExposure = 0.35;
        }
        this._isOpenAirBackground = isOpenAir;

        // ── Set lighting targets ──────────────────────────────────────────────────
        // Only target values are written here; actual intensities are lerped below.
        // This prevents hard jumps when the train crosses a zone boundary.
        if (isOpenAir) {
            // Day environment: real sky photo (equirectangular background, no extra draw call)
            this.scene.background = this.skyTexture;
            this.scene.fog.color = this.skyColor;

            this._targetAmbient    = isPlatform ? 0.85 : 0.6;
            this._targetSun        = 2.5;
            this._targetHeadlight  = 1.0;
            this._targetFogDensity = 0.0015;
        } else {
            // Tunnel environment
            this.scene.background = this.tunnelColor;
            this.scene.fog.color = this.tunnelColor;

            if (isPlatform) {
                // Brightly lit underground station
                this._targetAmbient    = 0.55;
                this._targetSun        = 0.0;
                this._targetHeadlight  = 12.0;
                this._targetFogDensity = 0.0;
            } else {
                // Dark tunnel
                this._targetAmbient    = 0.05;
                this._targetSun        = 0.0;
                this._targetHeadlight  = 20.0;
                this._targetFogDensity = 0.0;
            }
        }

        if (this.scene.fog && this.scene.fog.densityOverride !== undefined) {
            this._targetFogDensity = this.scene.fog.densityOverride;
        }

        // ── Exponential smoothing toward targets ──────────────────────────────────
        // Separate speeds for brightening vs. darkening to mimic pupil adaptation:
        // eyes constrict quickly in bright light, dilate slowly in the dark.
        const safeDt = Math.min(dt || 0.016, 0.1);

        const _lerpLight = (current, target) => {
            const speed = (target > current) ? this._lightSpeedBright : this._lightSpeedDark;
            return current + (target - current) * (1 - Math.exp(-safeDt * speed));
        };

        this.ambientLight.intensity  = _lerpLight(this.ambientLight.intensity,  this._targetAmbient);
        this.sunLight.intensity      = _lerpLight(this.sunLight.intensity,      this._targetSun);
        this.headlight.intensity     = _lerpLight(this.headlight.intensity,     this._targetHeadlight);
        this.scene.fog.density       = _lerpLight(this.scene.fog.density,       this._targetFogDensity);

        // ── Eye adaptation (exposure eases from flash value back to 1.0) ─────────
        if (this.adaptationActive) {
            this.adaptationTimer += safeDt; // safeDt already clamped above
            const k = Math.min(this.adaptationTimer / this.adaptationDuration, 1.0);
            const s = k * k * (3.0 - 2.0 * k); // smoothstep: hold the blinded moment, then land softly
            this.renderer.toneMappingExposure = this.adaptationFromExposure + (1.0 - this.adaptationFromExposure) * s;
            if (k >= 1.0) {
                this.adaptationActive = false;
                this.renderer.toneMappingExposure = 1.0;
            }
        }
    }

    getChunkTypeAtDistance(z) {
        return this.sim.getChunkType(z);
    }

    isInsideStationPlatform(z) {
        for (let i = 0; i < this.sim.stations.length; i++) {
            const s = this.sim.stations[i];
            if (Math.abs(z - s.position) <= s.halfLength + 1) { // platform half-length + a tiny margin
                return true;
            }
        }
        return false;
    }

    isCurrentViewReverberant() {
        if (this.activeCameraType !== 'platform') {
            return false;
        }

        const currentStation = this.sim.stations[this.sim.currentStationIdx];
        const nextStation = this.sim.stations[this.sim.nextStationIdx];
        const trainZ = this.sim.position;
        const distToNext = Math.abs(trainZ - nextStation.position);
        const targetStation = (distToNext < 120) ? nextStation : currentStation;

        const chunkType = this.sim.getChunkType(targetStation.position);
        return chunkType === 'underground' || chunkType === 'shaft';
    }
}
