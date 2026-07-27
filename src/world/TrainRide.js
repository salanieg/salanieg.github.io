// ============================================================================
// TrainRide — the doors of the subway transition, both cars.
//
// Both DT1 cars (WP4 cavern, WP1 atrium terminus) are static. The camera rides
// to the seat inside the mine car, its doors close, the rig cuts across the
// teleport to the identical seat inside the plaza car — and those doors open so
// the visitor can step out onto the terminus.
//
// The whole cycle is scrubbed off the path position, exactly like the atrium
// banner: no one-shot triggers, so scrubbing back re-plays the close/open in
// reverse and the pose is a pure function of `rig.u`. Timing is anchored to the
// two seat samples (rig.uIn / rig.uOut) and expressed in rail samples, because
// that is what "how far has the visitor actually moved" means here — ~0.41 m per
// sample on the approach, ~0.105 m on the walk out of the plaza car.
//
// One clip per car, never both: `mine_doors_close` runs 0 = open → 1 = shut,
// `plaza_doors_open` runs 0 = shut → 1 = open. The opposing pair is left unplayed
// in interactions.js (CONFLICT_CLIPS) so nothing fights over the same leaves.
// ============================================================================

// offsets in rail samples from the seat each phase belongs to
const MINE_SHUT_FROM = -6;    // camera is past the door plane, inside the car
const MINE_SHUT_TO = -2;      // fully shut ~0.8 m short of the cut
const PLAZA_OPEN_FROM = 4;    // a beat seated in the closed car at the terminus
const PLAZA_OPEN_TO = 24;     // wide open ~2.5 m before the visitor reaches it
const RESET_FROM = 55;        // behind the loop seam: plaza shuts, mine re-opens
const RESET_TO = 63;

export class TrainRide {
    constructor(scene, rig, actions) {
        this.root = scene.getObjectByName('DT1_Root');
        this.rig = rig;
        this.actions = actions;
        // fall back to the old constants if cam_path.json predates the
        // teleport metadata
        const du = 1 / rig.count;
        const uIn = rig.uIn > 0 ? rig.uIn : 0.9077;
        const uOut = rig.uOut > 0 ? rig.uOut : 0.9091;
        this.mineShut = [uIn + MINE_SHUT_FROM * du, uIn + MINE_SHUT_TO * du];
        this.plazaOpen = [uOut + PLAZA_OPEN_FROM * du, uOut + PLAZA_OPEN_TO * du];
        this.reset = [uOut + RESET_FROM * du, uOut + RESET_TO * du];
    }

    update(_t) {
        if (!this.root) return;
        const u = ((this.rig.u % 1) + 1) % 1;
        const back = ramp(u, this.reset[0], this.reset[1]);
        // mine: open all the way in, shut from just inside the door to the cut,
        // re-opened behind the loop seam so the next lap arrives at open doors
        scrub(this.actions.mine_doors_close,
              ramp(u, this.mineShut[0], this.mineShut[1]) - back);
        // plaza: shut on arrival, opening as the visitor rises from the seat,
        // shut again behind them once they are clear of the doorway
        scrub(this.actions.plaza_doors_open,
              ramp(u, this.plazaOpen[0], this.plazaOpen[1]) - back);
    }
}

function scrub(action, p) {
    if (!action) return;
    action.time = Math.max(0, Math.min(1, p)) * action.getClip().duration;
}

function ramp(x, a, b) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}
