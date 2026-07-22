// ============================================================================
// ScrollRig — drives the camera along the baked Blender rail.
//
// cam_path.json carries uniform arc-length samples in Blender Z-up world
// space ([w,x,y,z] quats). We convert once to three.js Y-up and then map
// user scroll (wheel / touch / drag / keys) onto the loop. Scroll space is
// NOT the same as path space: the dark return tunnel is ~60 % of the path
// but gets only ~15 % of the scroll range, so it plays as a fast whoosh.
// ============================================================================
import * as THREE from 'three';

// Blender Z-up world → three.js Y-up (matches the glTF exporter's conversion)
const Z2Y = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _ta = new THREE.Vector3();
const _tb = new THREE.Vector3();
const _look = new THREE.Quaternion();
const _lookEuler = new THREE.Euler();

export class ScrollRig {
    constructor(pathData, anchors) {
        this.positions = [];
        this.quats = [];
        for (const s of pathData.samples) {
            const [x, y, z] = s.p;
            this.positions.push(new THREE.Vector3(x, z, -y));
            const [w, qx, qy, qz] = s.q_wxyz;
            this.quats.push(new THREE.Quaternion(qx, qy, qz, w).premultiply(Z2Y));
        }
        this.count = this.positions.length;
        this.anchors = anchors;

        // scroll-space plan: [waypoint key, scroll fraction]; u comes from the GLB
        const plan = [
            ['__start', 0.00, 0.0],
            ['home', 0.05, anchors.home],
            ['projects', 0.30, anchors.projects],
            ['projects_boat', 0.36, anchors.projects_boat],
            ['about', 0.60, anchors.about],
            ['contact', 0.82, anchors.contact],
            ['contact_inside', 0.875, anchors.contact_inside],
            ['__exit', 0.97, 0.975],      // train arrival at the plaza portal
            ['__loop', 1.00, 1.0],
        ];
        this.stops = plan.map(([name, s, u]) => ({ name, s, u }));
        this.inputEnabled = true;

        this.target = 0;
        this.current = 0;
        this.tween = null;
        this.pos = new THREE.Vector3();
        this.quat = new THREE.Quaternion();
        this.stopPoses = {};      // name -> {pos, quat} from the cam_wp* empties
        this.lookX = 0;      // mouse parallax
        this.lookY = 0;
        this._lookXS = 0;
        this._lookYS = 0;
        this.onFirstMove = null;
        this._moved = false;
    }

    // ---- input ------------------------------------------------------------
    attach(dom) {
        const SPEED = 0.000055;
        dom.addEventListener('wheel', (e) => {
            e.preventDefault();
            const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
            this._push(d * SPEED);
        }, { passive: false });

        let dragY = null;
        dom.addEventListener('pointerdown', (e) => { dragY = e.clientY; });
        dom.addEventListener('pointermove', (e) => {
            this.lookX = (e.clientX / window.innerWidth) * 2 - 1;
            this.lookY = (e.clientY / window.innerHeight) * 2 - 1;
            if (dragY !== null && e.pressure > 0) {
                this._push((dragY - e.clientY) * 0.00045);
                dragY = e.clientY;
            }
        });
        dom.addEventListener('pointerup', () => { dragY = null; });
        dom.addEventListener('pointercancel', () => { dragY = null; });

        window.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' || e.key === 'PageDown') this._push(0.012);
            else if (e.key === 'ArrowUp' || e.key === 'PageUp') this._push(-0.012);
            else if (e.key === ' ') { e.preventDefault(); this.nextStop(1); }
        });
    }

    _push(ds) {
        if (!this.inputEnabled) return;
        this.tween = null;
        this.target += ds;
        if (!this._moved && Math.abs(ds) > 0.0005) {
            this._moved = true;
            this.onFirstMove && this.onFirstMove();
        }
    }

    // ---- navigation -------------------------------------------------------
    goToS(sTarget) {
        // travel forward (the world is a one-way loop)
        const cur = this.target;
        let delta = (sTarget - mod1(cur)) % 1;
        if (delta < -0.02) delta += 1;
        this.tween = { from: cur, to: cur + delta, t: 0, dur: Math.max(1.2, Math.abs(delta) * 6) };
        this._moved = true;
        this.onFirstMove && this.onFirstMove();
    }

    goToStop(name) {
        const st = this.stops.find((s) => s.name === name);
        if (st) this.goToS(st.s);
    }

    nextStop(dir) {
        const s = mod1(this.current);
        const named = this.stops.filter((st) => !st.name.startsWith('__'));
        if (dir > 0) {
            const nx = named.find((st) => st.s > s + 0.01) || named[0];
            this.goToS(nx.s);
        } else {
            const pv = [...named].reverse().find((st) => st.s < s - 0.01) || named[named.length - 1];
            this.goToS(pv.s);
        }
    }

    nearestStop(maxDist = 0.035) {
        const s = mod1(this.current);
        let best = null;
        for (const st of this.stops) {
            if (st.name.startsWith('__')) continue;
            const d = Math.min(Math.abs(st.s - s), 1 - Math.abs(st.s - s));
            if (d < maxDist && (!best || d < best.d)) best = { ...st, d };
        }
        return best;
    }

    // ---- evaluation -------------------------------------------------------
    sToU(sIn) {
        const s = mod1(sIn);
        for (let i = 0; i < this.stops.length - 1; i++) {
            const a = this.stops[i];
            const b = this.stops[i + 1];
            if (s >= a.s && s <= b.s) {
                const t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
                return a.u + (b.u - a.u) * smooth(t);
            }
        }
        return 0;
    }

    uOfPoint(worldPos) {
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < this.count; i++) {
            const d = this.positions[i].distanceToSquared(worldPos);
            if (d < bestD) { bestD = d; best = i; }
        }
        return best / this.count;
    }

    uToS(uTarget) {
        // sToU is monotonic — invert by bisection
        let lo = 0;
        let hi = 1;
        for (let i = 0; i < 40; i++) {
            const mid = (lo + hi) / 2;
            if (this.sToU(mid) < uTarget) lo = mid;
            else hi = mid;
        }
        return (lo + hi) / 2;
    }

    tangent(u, out) {
        const eps = 1.5 / this.count;
        this.sample(u - eps, _ta, _qa);
        this.sample(u + eps, _tb, _qb);
        out.subVectors(_tb, _ta);
        return out.length() > 1e-6 ? out.normalize() : out.set(0, 0, 1);
    }

    sample(u, outPos, outQuat) {
        const f = mod1(u) * this.count;
        const i0 = Math.floor(f) % this.count;
        const i1 = (i0 + 1) % this.count;
        const t = f - Math.floor(f);
        outPos.lerpVectors(this.positions[i0], this.positions[i1], t);
        _qa.copy(this.quats[i0]);
        _qb.copy(this.quats[i1]);
        outQuat.slerpQuaternions(_qa, _qb, t);
    }

    setStopPoses(poses) {
        this.stopPoses = poses;
    }

    update(dt) {
        if (this.tween) {
            this.tween.t += dt;
            const k = Math.min(1, this.tween.t / this.tween.dur);
            this.target = this.tween.from + (this.tween.to - this.tween.from) * smooth(k);
            if (k >= 1) this.tween = null;
        }
        this.current += (this.target - this.current) * (1 - Math.exp(-dt * 3.2));
        this.u = this.sToU(this.current);
        this.sample(this.u, this.pos, this.quat);
        // near a waypoint, ease into the exact framing authored on its empty
        const s = mod1(this.current);
        for (const st of this.stops) {
            const pose = this.stopPoses[st.name];
            if (!pose) continue;
            const d = Math.min(Math.abs(st.s - s), 1 - Math.abs(st.s - s));
            const R = 0.045;
            if (d < R) {
                const w = (1 - smooth(d / R)) * 0.92;
                this.pos.lerp(pose.pos, w);
                this.quat.slerp(pose.quat, w);
            }
        }
        // subtle mouse look-around on top of the rail orientation
        this._lookXS += (this.lookX - this._lookXS) * (1 - Math.exp(-dt * 4));
        this._lookYS += (this.lookY - this._lookYS) * (1 - Math.exp(-dt * 4));
        _lookEuler.set(-this._lookYS * 0.05, -this._lookXS * 0.07, 0, 'YXZ');
        _look.setFromEuler(_lookEuler);
        this.quat.multiply(_look);
    }
}

function mod1(x) { return ((x % 1) + 1) % 1; }
function smooth(t) { return t * t * (3 - 2 * t); }
