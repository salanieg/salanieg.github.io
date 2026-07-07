import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Reusable temp vectors for per-frame camera math (avoid GC churn)
const _wmPos = new THREE.Vector3();
const _wmTan = new THREE.Vector3();
const _wmTarget = new THREE.Vector3();
const _wmOffset = new THREE.Vector3();

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
        this.tunnelColor = new THREE.Color('#050505'); // Dark tunnel
        this._isOpenAirBackground = null; // tracks which background is active (avoids Color/Texture .equals())
        
        // Eye adaptation effect
        this.adaptationTimer = 0;
        this.adaptationActive = false;

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
            if (e.button === 0) this.startLook(e.clientX, e.clientY);
        };

        this.onMouseMove = (e) => {
            this.moveLook(e.clientX, e.clientY);
        };

        this.onMouseUp = (e) => {
            if (e.button === 0) this.endLook();
        };

        // Touch equivalents (single-finger look-around, two-finger pinch-to-zoom)
        this.onTouchStart = (e) => {
            if (e.touches.length === 1) {
                const t = e.touches[0];
                this.startLook(t.clientX, t.clientY);
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
            }
        };

        this.onWheel = (e) => {
            if (this.activeCameraType === 'orbit') {
                this.orbitDistance += e.deltaY * 0.05;
                this.orbitDistance = Math.max(5, Math.min(5000, this.orbitDistance));
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

    setupLights() {
        // Ambient Light
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6); // Brighter ambient daylight
        this.scene.add(this.ambientLight);

        // Sun light (for open air areas, disabled in tunnels)
        this.sunLight = new THREE.DirectionalLight(0xffffff, 2.5); // Bright white sunlight
        this.sunLight.position.set(-100, 150, 50); // Sun higher up
        this.scene.add(this.sunLight);

        // Train Headlight (spotlight attached to the front of the train)
        this.headlight = new THREE.SpotLight(0xffffff, 5.0, 150, Math.PI / 6, 0.5, 1.0);
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
        const trainLength = (isG1 ? 76.170 : 76.0); // 1:1 – volle Zuglänge in Metern
        
        // Train front is at trainZ, rear is at trainZ - direction * trainLength
        const frontZ = trainZ;
        const rearZ = trainZ - direction * trainLength;
        const centerZ = trainZ - direction * (trainLength / 2);

        // Update lighting based on environment (tunnel vs open-air)
        this.updateEnvironmentLighting(trainZ);

        // Update headlight position (always at the front of the train, relative to active leading carriage)
        const activeCabCar = train3D.carriages[this.sim.isReversing ? 3 : 0];
        const activeCarLength = isG1 ? 19.270 : 19.0;
        
        const headLocalPos = this.sim.isReversing ? new THREE.Vector3(0, 1.2, -activeCarLength - 0.5) : new THREE.Vector3(0, 1.2, 0.5);
        const headLocalTarget = this.sim.isReversing ? new THREE.Vector3(0, 1.0, -99.0) : new THREE.Vector3(0, 1.0, 80.0);
        this.headlight.position.copy(activeCabCar.localToWorld(headLocalPos));
        this.headlight.target.position.copy(activeCabCar.localToWorld(headLocalTarget));

        // Update camera position depending on active mode
        switch (this.activeCameraType) {
            case 'cab': {
                // Driver's perspective inside the active leading carriage
                const cabLocalPos = this.sim.isReversing ? new THREE.Vector3(0, 2.00, -activeCarLength + 1.2) : new THREE.Vector3(0, 2.00, -1.2);

                // Calculate local direction vector with relative yaw/pitch (smoothed
                // towards the touch/mouse-driven target so drag jitter isn't jarring)
                this._smoothRotation(this.cabRotationView, this.cabRotation, dt);
                const defaultYaw = this.sim.isReversing ? Math.PI : 0;
                const yaw = defaultYaw + this.cabRotationView.yaw;
                const pitch = this.cabRotationView.pitch;
                
                const localDir = new THREE.Vector3(
                    Math.sin(yaw) * Math.cos(pitch),
                    Math.sin(pitch),
                    Math.cos(yaw) * Math.cos(pitch)
                );
                
                const localTarget = cabLocalPos.clone().add(localDir);
                
                const worldPos = activeCabCar.localToWorld(cabLocalPos.clone());
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
                const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
                const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

                const moveVec = new THREE.Vector3();
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
                if (this.passengerLocalPos.z > 0 && this.passengerCarIdx > 0) {
                    this.passengerCarIdx--;
                    this.passengerLocalPos.z -= 19;
                } else if (this.passengerLocalPos.z < -19 && this.passengerCarIdx < 3) {
                    this.passengerCarIdx++;
                    this.passengerLocalPos.z += 19;
                }
                
                // Clamp passenger to coach interior space:
                // Width is 2.18m (Passage between carriages is ~1.68m wide)
                this.passengerLocalPos.x = Math.max(-0.75, Math.min(0.75, this.passengerLocalPos.x));

                // Length clamping (entire train from front cockpit to rear cockpit)
                const cabLen = isG1 ? 1.9 : 1.44;
                let minZ = -19;
                let maxZ = 0;
                if (this.passengerCarIdx === 0) maxZ = -(cabLen + 0.05); // don't clip into front cab
                if (this.passengerCarIdx === 3) minZ = -19 + (cabLen + 0.05); // don't clip into rear cab

                this.passengerLocalPos.z = Math.max(minZ, Math.min(maxZ, this.passengerLocalPos.z));

                // Camera height set to local height of 2.11m (aligned with windows in scaled coordinate space)
                this.passengerLocalPos.y = 2.11;

                // Final carriage reference for world transform
                const currentCar = train3D.carriages[this.passengerCarIdx];

                // Calculate local direction vector from passenger yaw/pitch
                const localDir = new THREE.Vector3(
                    Math.sin(yaw) * Math.cos(this.passengerRotationView.pitch),
                    Math.sin(this.passengerRotationView.pitch),
                    Math.cos(yaw) * Math.cos(this.passengerRotationView.pitch)
                );
                
                const localTarget = this.passengerLocalPos.clone().add(localDir);
                const worldPos = currentCar.localToWorld(this.passengerLocalPos.clone());
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
                    
                    const camZ = targetStation.position - 20.0;
                    const statPos = this.sim.getTrackPosition(camZ);
                    const statTangent = this.sim.getTrackTangent(camZ);
                    const statNormal = new THREE.Vector3(-statTangent.z, 0, statTangent.x);
                    
                    const isSideStation = targetStation && targetStation.side;
                    const isScharfreiterring = targetStation && (targetStation.name === "Scharfreiterring");
                    const isPlaerrer = targetStation && (targetStation.name === "Plärrer");
                    const spacing = this.sim.getTrackSpacing(camZ);
                    // Plärrer: the island platform is offset to the side; pick the UPPER deck
                    // when heading Hardhöhe (forward) and the LOWER deck when heading Langwasser.
                    const baseLocalX = isPlaerrer ? -5.0 : (isScharfreiterring ? (spacing / 2 - 2.58) : (isSideStation ? spacing / 2 + 2.8 : 0));
                    // Plain island platforms (no special-cased offset above) shouldn't always
                    // spawn dead-centre - clearly off to one side, like a person would stand,
                    // never within 2m of the middle.
                    const side = Math.random() < 0.5 ? -1 : 1;
                    const localX = (baseLocalX === 0) ? side * (2.0 + Math.random() * 2.5) : baseLocalX;
                    const levelY = (isPlaerrer && this.sim.isReversing) ? -this.sim.plaerrerDrop : 0;

                    const defaultPos = statPos.clone().addScaledVector(statNormal, localX);
                    defaultPos.y = statPos.y + levelY + 2.575;
                    
                    this.cameras.platform.position.copy(defaultPos);
                    
                    // Point camera at the train's cab
                    const trainCabinLocalPos = this.sim.isReversing ? new THREE.Vector3(0, 1.2, -19.0) : new THREE.Vector3(0, 1.2, 0.0);
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
                const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
                const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

                const moveVec = new THREE.Vector3();
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
                const plLevelY = (targetStation.name === "Plärrer" && this.sim.isReversing) ? -this.sim.plaerrerDrop : 0;
                const stationY = this.sim.getTrackPosition(targetStation.position, _wmPos).y;
                this.cameras.platform.position.y = stationY + plLevelY + 2.575;

                // Compute look direction from yaw/pitch
                const lookDir = new THREE.Vector3(
                    Math.sin(yaw) * Math.cos(this.platformRotationView.pitch),
                    Math.sin(this.platformRotationView.pitch),
                    Math.cos(yaw) * Math.cos(this.platformRotationView.pitch)
                );
                
                const targetPos = this.cameras.platform.position.clone().add(lookDir);
                this.cameras.platform.lookAt(targetPos);
                break;
            }
                
            case 'orbit': {
                // Chase camera orbiting around the cockpit (leading cab), not the whole
                // train's centre - trainZ is the very front tip, so pull back just enough
                // to land roughly on the driver's position (see the cab camera's own
                // cabLocalPos z-offset of ~1.2m above) instead of half the train's length.
                const direction = this.sim.isReversing ? -1 : 1;
                const centerZ = trainZ - direction * 1.5;
                this.sim._sampleTrack(centerZ, _wmPos, _wmTan);

                // Target slightly above track level
                const targetPos = _wmTarget.copy(_wmPos);
                targetPos.y += 1.8;

                // Train yaw from track tangent
                const trainYaw = Math.atan2(_wmTan.x, _wmTan.z);

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

                // Prevent camera from falling below track level
                const groundY = _wmPos.y + 0.5;
                if (this.cameras.orbit.position.y < groundY) {
                    this.cameras.orbit.position.y = groundY;
                }

                this.cameras.orbit.lookAt(targetPos);
                break;
            }
        }

        // Apply render
        this.renderer.render(this.scene, this.activeCamera);
    }
    updateEnvironmentLighting(trainZ) {
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
            // Emerging from tunnel: trigger eye flash adaptation
            this.adaptationActive = true;
            this.adaptationTimer = 1.0; // 1 second flash
        } else if (!isOpenAir && this._isOpenAirBackground === true) {
            // Entering tunnel: quick dark adaptation
            this.adaptationActive = true;
            this.adaptationTimer = 0.5;
        }
        this._isOpenAirBackground = isOpenAir;

        if (isOpenAir) {
            // Day environment: real sky photo (equirectangular background, no extra draw call)
            this.scene.background = this.skyTexture;
            this.scene.fog.color = this.skyColor;
            this.scene.fog.density = 0.0015; // very light fog for distance depth
            
            this.ambientLight.intensity = isPlatform ? 0.85 : 0.6; // Brighter ambient daylight
            this.sunLight.intensity = 2.5; // Bright sunlight
            this.headlight.intensity = 0.5; // Headlights barely visible during day
        } else {
            // Tunnel environment
            this.scene.background = this.tunnelColor;
            this.scene.fog.color = this.tunnelColor;

            if (isPlatform) {
                // Brightly lit station (clear view, no thick black fog)
                this.scene.fog.density = 0.0;
                this.ambientLight.intensity = 0.85;
                this.sunLight.intensity = 0.0;
                this.headlight.intensity = 3.0;
            } else {
                // Dark tunnel
                this.scene.fog.density = 0.0; // less dense dark tunnel fog
                this.ambientLight.intensity = 0.35;
                this.sunLight.intensity = 0.0; // no sun inside tunnel
                this.headlight.intensity = 8.0; // powerful headlight in dark
            }
        }

        if (this.scene.fog && this.scene.fog.densityOverride !== undefined) {
            this.scene.fog.density = this.scene.fog.densityOverride;
        }

        // Apply eye adaptation flash (boost exposure briefly)
        if (this.adaptationActive && this.adaptationTimer > 0) {
            this.adaptationTimer -= 0.016; // approximate dt (60fps)
            if (this.adaptationTimer <= 0) {
                this.adaptationActive = false;
                this.renderer.toneMappingExposure = 1.0;
            } else {
                if (isOpenAir) {
                    // Flash white/bright exposure
                    this.renderer.toneMappingExposure = 1.0 + this.adaptationTimer * 2.0;
                } else {
                    // Temporarily dark, then settle
                    this.renderer.toneMappingExposure = 0.3 + (1 - this.adaptationTimer) * 0.7;
                }
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
