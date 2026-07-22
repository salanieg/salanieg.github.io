// ============================================================================
// TrainRide — the DT1 carries the visitor home through the loop tunnel.
//
// After boarding at the platform (doors close behind you via the existing
// crossing trigger), the whole DT1_Root is moved along the camera rail so the
// visitor's seat stays fixed inside the carriage while the tunnel slides by.
// At the plaza portal the train parks, the doors open, and the camera glides
// out while the rear gangway is opened up. Everything is stateless in s, so
// scrolling backwards rewinds the ride, and after the loop seam the train is
// quietly back at the platform.
// ============================================================================
import * as THREE from 'three';

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _tan = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _zero = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _seatWorld = new THREE.Vector3();

export class TrainRide {
    constructor(scene, rig, actions) {
        this.root = scene.getObjectByName('DT1_Root');
        this.rig = rig;
        this.actions = actions;
        if (!this.root) return;
        this.staticPos = this.root.position.clone();
        this.staticQuat = this.root.quaternion.clone();
        const inside = rig.stops.find((s) => s.name === 'contact_inside');
        const exit = rig.stops.find((s) => s.name === '__exit');
        // engage once the rider is settled in the rear carriage (path space,
        // then inverted into scroll space — the tunnel is scroll-compressed)
        const uStart = inside.u + 0.012;
        this.sStart = rig.uToS(uStart);
        this.sEnd = exit.s;
        this.uEnd = exit.u;
        // seat = rail point at ride start, expressed in the parked train's
        // frame (parked rotation is identity, so a plain offset suffices)
        rig.sample(uStart, _pos, _quat);
        this.seatLocal = _pos.clone().sub(this.staticPos);
        // gangway/end walls open up so the exit reads as walking out the back
        this.gangwayParts = ['DT1_Car1_EndWall_R', 'DT1_Car1_EndWin_R',
                             'DT1_Car2_EndWall_F', 'DT1_Car2_EndWall_R',
                             'DT1_Car2_EndWin_R']
            .map((n) => scene.getObjectByName(n)).filter(Boolean);
        // warm interior lighting so the ride is readable in the dark tunnel
        for (const zLocal of [204, 210, 216, 226]) {
            const li = new THREE.PointLight(0xfff2da, 7, 9, 1.6);
            li.position.set(0, 3.2, zLocal);
            this.root.add(li);
        }
        this.exitDoorsFired = false;
        this.riding = false;
    }

    _poseAt(u, tSway) {
        this.rig.sample(u, _pos, _quat);
        this.rig.tangent(u, _tan);
        // rigid unit entered tail-first: local +Z stays on the travel tangent
        _m.lookAt(_zero, _tan.clone().negate(), _up);
        _quat.setFromRotationMatrix(_m);
        _seatWorld.copy(this.seatLocal).applyQuaternion(_quat);
        _pos.sub(_seatWorld);
        if (tSway) {
            _pos.y += Math.sin(tSway * 6.3) * 0.02;
        }
        this.root.position.copy(_pos);
        this.root.quaternion.copy(_quat);
    }

    update(t) {
        if (!this.root) return;
        const s = ((this.rig.current % 1) + 1) % 1;
        if (s >= this.sStart && s < this.sEnd) {
            this._poseAt(this.rig.u, t);
            this.riding = true;
            this._gangway(false);
        } else if (s >= this.sEnd && s < 0.9985) {
            this._poseAt(this.uEnd, 0);
            if (!this.exitDoorsFired) {
                this.exitDoorsFired = true;
                const a = this.actions.doors_open;
                if (a) a.reset().play();
            }
            this.riding = false;
            this._gangway(true);
        } else {
            this.root.position.copy(this.staticPos);
            this.root.quaternion.copy(this.staticQuat);
            this.exitDoorsFired = false;
            this.riding = false;
            this._gangway(false);
        }
    }

    _gangway(open) {
        for (const part of this.gangwayParts) part.visible = !open;
    }
}
