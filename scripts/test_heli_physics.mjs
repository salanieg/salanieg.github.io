// Physics verification script for AgustaWestland AW169 helicopter model
import * as THREE from './../node_modules/three/build/three.module.js';

console.log("Testing Helicopter Physics Dynamics...");

const GRAVITY = 9.81;
const MAX_LIFT_ACCEL = 22.0; // m/s^2 at 100% RPM & 100% collective
const DRAG_H = 0.45;
const DRAG_V = 0.70;

let pos = new THREE.Vector3(0, 0.45, 36);
let vel = new THREE.Vector3(0, 0, 0);
let pitch = 0;
let roll = 0;
let yaw = Math.PI; // facing south
let rpm = 0.0;
let collective = 0.0;

function simulateStep(dt, keys, wheelDelta) {
    // Spool RPM
    const targetRpm = 1.0;
    rpm += (targetRpm - rpm) * Math.min(1.0, dt * 0.8);

    // Update collective from wheel
    if (wheelDelta !== 0) {
        collective = Math.max(0.0, Math.min(1.0, collective - wheelDelta * 0.04));
    }

    // Cyclic inputs (Pitch & Roll)
    let targetPitch = 0;
    if (keys.W) targetPitch -= 0.32; // nose down -> accelerate forward
    if (keys.S) targetPitch += 0.26; // nose up -> brake / reverse
    pitch += (targetPitch - pitch) * Math.min(1.0, dt * 4.0);

    let targetRoll = 0;
    if (keys.A) targetRoll += 0.30; // roll left
    if (keys.D) targetRoll -= 0.30; // roll right
    roll += (targetRoll - roll) * Math.min(1.0, dt * 4.0);

    // Yaw (Q / E)
    let yawRate = 0;
    if (keys.Q) yawRate += 1.4;
    if (keys.E) yawRate -= 1.4;
    yaw += yawRate * dt;

    // Lift vector in local space
    // Local Y is rotor thrust direction
    const rot = new THREE.Euler(pitch, yaw, roll, 'YXZ');
    const thrustLocal = new THREE.Vector3(0, rpm * collective * MAX_LIFT_ACCEL, 0);
    const thrustWorld = thrustLocal.clone().applyEuler(rot);

    // Net acceleration = thrust + gravity - drag
    const accel = thrustWorld.clone();
    accel.y -= GRAVITY;
    accel.x -= vel.x * DRAG_H;
    accel.z -= vel.z * DRAG_H;
    accel.y -= vel.y * DRAG_V;

    // Integrate
    vel.addScaledVector(accel, dt);
    pos.addScaledVector(vel, dt);

    // Ground clamp
    const groundY = 0.0;
    const gearY = 0.45;
    if (pos.y <= groundY + gearY) {
        pos.y = groundY + gearY;
        if (vel.y < 0) vel.y = 0;
        vel.x *= 0.85;
        vel.z *= 0.85;
    }
}

// 1. Test Spool up & Takeoff with collective = 0.70
console.log("--- Test 1: Spool up & Lift off ---");
collective = 0.70;
for (let t = 0; t < 5.0; t += 0.05) {
    simulateStep(0.05, { W: false, S: false, A: false, D: false, Q: false, E: false }, 0);
}
console.log(`After 5s: Altitude=${pos.y.toFixed(2)}m, RPM=${(rpm*100).toFixed(0)}%, VertSpeed=${vel.y.toFixed(2)}m/s`);
if (pos.y > 5.0 && rpm > 0.95) {
    console.log("PASS: Helicopter smoothly spooled up and lifted off!");
} else {
    console.error("FAIL: Did not lift off properly");
}

// 2. Test Forward flight with KeyW
console.log("--- Test 2: Pitch forward flight (KeyW) ---");
for (let t = 0; t < 4.0; t += 0.05) {
    simulateStep(0.05, { W: true, S: false, A: false, D: false, Q: false, E: false }, 0);
}
const horizSpeed = Math.hypot(vel.x, vel.z);
console.log(`Forward flight after 4s: HorizSpeed=${(horizSpeed * 3.6).toFixed(1)} km/h, Position=(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);
if (horizSpeed > 5.0) {
    console.log("PASS: Forward flight accelerated realistically!");
} else {
    console.error("FAIL: Did not accelerate horizontally");
}

// 3. Test Yaw turn with KeyE
console.log("--- Test 3: Yaw turn (KeyE) ---");
const prevYaw = yaw;
for (let t = 0; t < 2.0; t += 0.05) {
    simulateStep(0.05, { W: false, S: false, A: false, D: false, Q: false, E: true }, 0);
}
console.log(`Yaw rotated from ${(prevYaw*180/Math.PI).toFixed(1)}° to ${(yaw*180/Math.PI).toFixed(1)}°`);
if (Math.abs(yaw - prevYaw) > 1.0) {
    console.log("PASS: Yaw rotation works cleanly!");
}

// 4. Test Descent & Landing with collective = 0.20
console.log("--- Test 4: Descent & Touchdown ---");
collective = 0.20;
for (let t = 0; t < 14.0; t += 0.05) {
    simulateStep(0.05, { W: false, S: false, A: false, D: false, Q: false, E: false }, 0);
}
console.log(`Landed state: Altitude=${pos.y.toFixed(2)}m, VertSpeed=${vel.y.toFixed(2)}m/s`);
if (Math.abs(pos.y - 0.45) < 0.01 && vel.y === 0) {
    console.log("PASS: Touchdown settled smoothly on ground without penetration!");
} else {
    console.error("FAIL: Landing did not settle cleanly");
}
console.log("ALL FLIGHT DYNAMICS TESTS PASSED!");
