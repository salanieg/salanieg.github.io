import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
        this.skyColor = new THREE.Color('#93d5f8'); // Day sky blue
        this.tunnelColor = new THREE.Color('#050505'); // Dark tunnel
        
        // Eye adaptation effect
        this.adaptationTimer = 0;
        this.adaptationActive = false;

        // Passenger camera rotation (look-around)
        this.passengerRotation = { yaw: -Math.PI / 2, pitch: 0 };
        this.isDraggingPassenger = false;

        // Cockpit camera rotation (look-around)
        this.cabRotation = { yaw: 0, pitch: 0 };
        this.isDraggingCab = false;

        // Platform camera rotation (look-around) & drag state
        this.platformRotation = { yaw: 0, pitch: 0 };
        this.isDraggingPlatform = false;
        this.platformCameraStationIdx = -1; // track active station for platform view

        // Orbit camera rotation & zoom (fixed chase camera)
        this.orbitRotation = { yaw: Math.PI / 4, pitch: Math.PI / 8 };
        this.orbitDistance = 40;
        this.isDraggingOrbit = false;

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
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = false;
        this.container.appendChild(this.renderer.domElement);

        // Cameras Setup
        const aspect = this.container.clientWidth / this.container.clientHeight;
        
        // 1. Cab Camera (inside front cabin)
        this.cameras.cab = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
        
        // 2. Passenger Camera (inside passenger coach looking out window)
        this.cameras.passenger = new THREE.PerspectiveCamera(65, aspect, 0.1, 1000);
        
        // 3. Platform Camera (cinematic angle at next station)
        this.cameras.platform = new THREE.PerspectiveCamera(55, aspect, 0.1, 1000);
        
        // 4. Orbit Camera (general view)
        this.cameras.orbit = new THREE.PerspectiveCamera(60, aspect, 0.1, 2000);
        
        // Orbit Controls
        this.controls = new OrbitControls(this.cameras.orbit, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.05; // don't go below ground
        this.controls.minDistance = 5;
        this.controls.maxDistance = 150;
        
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
            // Raycasting for radio interaction (only in cab view)
            if (this.activeCameraType === 'cab') {
                this.mouse.x = (clientX / window.innerWidth) * 2 - 1;
                this.mouse.y = -(clientY / window.innerHeight) * 2 + 1;
                this.raycaster.setFromCamera(this.mouse, this.activeCamera);
                const intersects = this.raycaster.intersectObjects(this.scene.children, true);
                for (let intersect of intersects) {
                    if (intersect.object.userData.isRadio) {
                        this.sim.radioMenuOpen = true;
                        if (!this.sim.radioActive) {
                            this.sim.wantsRadioPlay = true;
                        }
                        break;
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

        this.moveLook = (clientX, clientY) => {
            const sens = 0.003;
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

        // Touch equivalents (single-finger look-around on smartphones/tablets)
        this.onTouchStart = (e) => {
            if (e.touches.length === 1) {
                const t = e.touches[0];
                this.startLook(t.clientX, t.clientY);
            }
        };

        this.onTouchMove = (e) => {
            if (e.touches.length === 1 && (this.isDraggingPassenger || this.isDraggingCab || this.isDraggingPlatform || this.isDraggingOrbit)) {
                e.preventDefault(); // avoid page scroll/rubber-banding while looking around
                const t = e.touches[0];
                this.moveLook(t.clientX, t.clientY);
            }
        };

        this.onTouchEnd = () => {
            this.endLook();
        };

        this.onWheel = (e) => {
            if (this.activeCameraType === 'orbit') {
                this.orbitDistance += e.deltaY * 0.05;
                this.orbitDistance = Math.max(5, Math.min(150, this.orbitDistance));
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

            // OrbitControls are disabled as we now use a custom fixed chase camera logic
            this.controls.enabled = false;

            if (type === 'platform') {
                this.platformCameraStationIdx = -1; // force reset position/look direction on next frame
            }
        }
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
                
                // Calculate local direction vector with relative yaw/pitch
                const defaultYaw = this.sim.isReversing ? Math.PI : 0;
                const yaw = defaultYaw + this.cabRotation.yaw;
                const pitch = this.cabRotation.pitch;
                
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

                // Handle walking inside the carriage (Arrow keys for camera walking)
                const walkSpeed = 4.5 * dt; // Brisk walking speed inside the train
                const yaw = this.passengerRotation.yaw;
                const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
                const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
                
                const moveVec = new THREE.Vector3();
                if (this.keysPressed.ArrowUp) moveVec.add(forward);
                if (this.keysPressed.ArrowDown) moveVec.sub(forward);
                if (this.keysPressed.ArrowRight) moveVec.add(right);
                if (this.keysPressed.ArrowLeft) moveVec.sub(right);
                
                if (moveVec.lengthSq() > 0) {
                    moveVec.normalize().multiplyScalar(walkSpeed);
                    this.passengerLocalPos.add(moveVec);

                    // Footstep sound triggering (slower, more intense)
                    this.footstepDistance += walkSpeed;
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
                    Math.sin(yaw) * Math.cos(this.passengerRotation.pitch),
                    Math.sin(this.passengerRotation.pitch),
                    Math.cos(yaw) * Math.cos(this.passengerRotation.pitch)
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
                    const localX = isPlaerrer ? -5.0 : (isScharfreiterring ? (spacing / 2 - 2.58) : (isSideStation ? spacing / 2 + 2.8 : 0));
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
                }
                
                // Handle walking on the platform (WASD are for train, arrow keys for camera walking)
                const walkSpeed = 5.0 * dt; // 5 m/s walking speed
                const yaw = this.platformRotation.yaw;
                const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
                const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
                
                const moveVec = new THREE.Vector3();
                if (this.keysPressed.ArrowUp) moveVec.add(forward);
                if (this.keysPressed.ArrowDown) moveVec.sub(forward);
                if (this.keysPressed.ArrowRight) moveVec.add(right);
                if (this.keysPressed.ArrowLeft) moveVec.sub(right);
                
                if (moveVec.lengthSq() > 0) {
                    moveVec.normalize().multiplyScalar(walkSpeed);
                    this.cameras.platform.position.add(moveVec);

                    // Footstep sound triggering (slower, more intense)
                    this.footstepDistance += walkSpeed;
                    if (this.footstepDistance > 2.2) {
                        if (this.onFootstep) this.onFootstep(0.25);
                        this.footstepDistance = 0;
                    }
                }
                
                // Ensure Y stays at exactly platform eye level relative to the station track elevation
                const plLevelY = (targetStation.name === "Plärrer" && this.sim.isReversing) ? -this.sim.plaerrerDrop : 0;
                const stationY = this.sim.getTrackPosition(targetStation.position).y;
                this.cameras.platform.position.y = stationY + plLevelY + 2.575;
                
                // Compute look direction from yaw/pitch
                const lookDir = new THREE.Vector3(
                    Math.sin(yaw) * Math.cos(this.platformRotation.pitch),
                    Math.sin(this.platformRotation.pitch),
                    Math.cos(yaw) * Math.cos(this.platformRotation.pitch)
                );
                
                const targetPos = this.cameras.platform.position.clone().add(lookDir);
                this.cameras.platform.lookAt(targetPos);
                break;
            }
                
            case 'orbit': {
                // Fixed chase camera focusing on the center of the train, following its rotation
                const direction = this.sim.isReversing ? -1 : 1;
                const centerZ = trainZ - direction * (this.sim.trainHalfLength);
                const { position: centerPos, tangent: centerTangent } = this.sim.getTrackPositionAndTangent(centerZ);

                // Target slightly above track level
                const targetPos = centerPos.clone();
                targetPos.y += 1.8;

                // Train yaw from track tangent
                const trainYaw = Math.atan2(centerTangent.x, centerTangent.z);

                // Calculate camera position relative to train center and orientation
                const yaw = trainYaw + this.orbitRotation.yaw;
                const pitch = this.orbitRotation.pitch;

                const offset = new THREE.Vector3(
                    Math.sin(yaw) * Math.cos(pitch),
                    Math.sin(pitch),
                    Math.cos(yaw) * Math.cos(pitch)
                ).multiplyScalar(this.orbitDistance);

                this.cameras.orbit.position.copy(targetPos).add(offset);
                
                // Prevent camera from falling below track level
                const groundY = centerPos.y + 0.5;
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
        if (isOpenAir && this.scene.background.equals(this.tunnelColor)) {
            // Emerging from tunnel: trigger eye flash adaptation
            this.adaptationActive = true;
            this.adaptationTimer = 1.0; // 1 second flash
        } else if (!isOpenAir && this.scene.background.equals(this.skyColor)) {
            // Entering tunnel: quick dark adaptation
            this.adaptationActive = true;
            this.adaptationTimer = 0.5;
        }

        if (isOpenAir) {
            // Day environment
            this.scene.background = this.skyColor;
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
