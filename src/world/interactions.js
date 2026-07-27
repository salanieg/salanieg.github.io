// ============================================================================
// interactions.js — everything clickable, triggered or drawn-at-runtime.
//
//  * link routing from userData.link_id (ResearchGate / Hinterstube /
//    Kenopsium / mailto / "coming soon" toast)
//  * position-scrubbed animation for banner_drop, saloon_doors_swing and
//    turnstile_spin (the DT1 car doors live in TrainRide.js)
//  * CanvasTextures: menu book pages (bio + resume) and the portrait banner
//  * analog clock set to real time, billboarded seat labels, HUD titles
// ============================================================================
import * as THREE from 'three';

const LINKS = {
    researchgate: { url: 'https://www.researchgate.net/profile/Dennis-Muench-3', ext: true },
    hinterstube: { url: './hinterstube.html', ext: false },
    kenopsium: { url: './kenopsium.html', ext: false },
    contact: { url: 'mailto:den.muench@gmail.com', ext: false },
    soon1: { toast: 'Bald verfügbar …' },
    soon2: { toast: 'Bald verfügbar …' },
};

const WP_TITLES = {
    home: 'ATRIUM',
    projects: 'MEINE PROJEKTE',
    projects_boat: 'MEINE PROJEKTE',
    about: 'ÜBER MICH',
    contact: 'KONTAKT',
    contact_inside: 'KONTAKT',
};

// real copy from the classic homepage (klassisch.html)
const ABOUT_P1 = 'Seit der Jahrtausendwende führte meine Laufbahn vom '
    + 'Kreißsaal in den Hörsaal und anschließend in den Sitzungssaal der '
    + 'Stadt Neustadt a.d.Aisch. An der Uni spiele ich gerade die '
    + 'Geisteswissenschaften durch (ohne Cheats) …';
const ABOUT_P2 = '… und vertiefe dabei die eigenen Kenntnisse im '
    + 'psychosozialen Bereich. Inspiriert von Jane Jacobs setze ich mich '
    + 'für ein resilientes, lebenswertes und ästhetisches fränkisches '
    + 'Neustadt ein. Mein guilty pleasure ist ein ÖPNV nur mit Flugtaxis.';
const START_TEXT = 'Überlegen Sie mal: Ein mattes und unambitioniertes '
    + 'Profil in einem sozialen Netzwerk für Geschäftskontakte, da sagt '
    + 'keiner was. Aber so eine eigene Website, pah, ziemlich eingebildet, '
    + 'oder? Als medienschaffende, forschende und politisch aktive Person '
    + 'beschäftige ich mich mit sozialen, didaktischen und ethischen '
    + 'Fragestellungen. Zwischen 2020 und 2026 setzte ich mich als '
    + 'parteiloses Mitglied im Stadtrat von Neustadt an der Aisch für die '
    + 'Erfordernisse einer modernen, resilienten und fränkischen Stadt ein.';

function wrapLines(text, max) {
    const out = [];
    for (const para of text.split('\n')) {
        let line = '';
        for (const word of para.split(' ')) {
            if ((line + ' ' + word).trim().length > max) {
                out.push(line.trim());
                line = word;
            } else {
                line += ' ' + word;
            }
        }
        out.push(line.trim());
    }
    return out;
}

const RESUME = [
    ['Seit 10/2023', 'M.A. Bildungswissenschaft', 'FernUniversität Hagen'],
    ['2019 – 2023', 'B.A. Kommunikationswiss.', 'Universität Bamberg'],
    ['2021', 'Projektmanagement', 'FernUniversität Hagen'],
    ['05/2020 – 04/2026', 'Stadtratsmitglied', 'Neustadt an der Aisch'],
    ['03 – 04/2025', 'Praktikum Jugendbetreuung', 'KJH gGmbH, Fürth'],
    ['05/2022 – 01/2024', 'Zuhörtelefon', 'Nightlines in Europe'],
    ['11/2020 – 03/2021', 'Radiomoderation', 'FriedaFM, Bamberg'],
];

export class Interactions {
    constructor({ scene, camera, rig, mixer, clips, dom, lampPool }) {
        this.scene = scene;
        this.camera = camera;
        this.rig = rig;
        this.mixer = mixer;
        this.dom = dom;
        this.lampPool = lampPool || null;
        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        this.clickables = [];
        this.billboards = [];
        this.clock = {};
        this._tmpParentQ = new THREE.Quaternion();
        this._tmpTargetQ = new THREE.Quaternion();
        this._billboardOffsetQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
        this.hovered = null;
        this.prevU = 0;
        this.actions = {};
        const CONFLICT_CLIPS = ['plaza_doors_close', 'mine_doors_open'];
        for (const clip of clips) {
            const action = mixer.clipAction(clip);
            if (clip.name.includes('horse') || clip.name.includes('idle') || clip.name.includes('Track')) {
                action.setLoop(THREE.LoopRepeat);
                action.play();
            } else if (CONFLICT_CLIPS.includes(clip.name)) {
                // Do not play opposing actions to prevent initial pose conflicts
            } else {
                action.setLoop(THREE.LoopOnce);
                action.clampWhenFinished = true;
                action.play();
                action.paused = true;
                action.time = 0;
            }
            this.actions[clip.name] = action;
        }
        this._collect();
        this._paintBook();
        this._paintBanner();
        this._setupTriggers();
        this._bindPointer();
        this._bindNav();
        this.titleEl = document.getElementById('wp-title');
        this.toastEl = document.getElementById('toast');
        this.navEl = document.getElementById('wp-nav');
        this._lastTitle = null;
    }

    _collect() {
        this.scene.traverse((o) => {
            const t = o.userData && o.userData.interactive_type;
            if (t === 'link' || t === 'page' || t === 'banner' || t === 'board') {
                this.clickables.push(o);
            }
            if (o.userData && o.userData.billboard) this.billboards.push(o);
            if (o.name === 'WP4_Clock_Hour') this.clock.hour = o;
            if (o.name === 'WP4_Clock_Minute') this.clock.minute = o;
            if (o.name === 'WP4_Clock_Second') this.clock.second = o;
            if (o.name === 'WP3_Batwing_L') {
                this.batwingL = o;
                this.qL_init = o.quaternion.clone();
            }
            if (o.name === 'WP3_Batwing_R') {
                this.batwingR = o;
                this.qR_init = o.quaternion.clone();
            }
            if (o.name === 'WP4_Turnstile_Rotor') this.turnstile = o;
        });
        // Mine lanterns get a warm light each — registered with the lamp pool
        // rather than added as real lights, so they cost nothing when they are
        // out of reach and never change the scene's light count (see fx.js).
        this.scene.traverse((o) => {
            if (/^WP4_Lantern_\d+$/.test(o.name)) {
                const body = o.children.find((ch) => ch.name.includes('_Body'));
                const at = body ? body.position : new THREE.Vector3(0, 0, -0.38);
                if (this.lampPool) {
                    this.lampPool.register(o, at,
                        { color: 0xffaa55, intensity: 5.5, distance: 9, decay: 1.8 });
                } else {
                    const li = new THREE.PointLight(0xffaa55, 5.5, 9, 1.8);
                    li.position.copy(at);
                    o.add(li);
                }
            }
        });
        // clock hands: re-pivot to rotate around their base like real hands
        for (const [key, len, z] of [['hour', 0.09, 0.035], ['minute', 0.13, 0.05], ['second', 0.15, 0.065]]) {
            const hand = this.clock[key];
            if (!hand) continue;
            hand.geometry = hand.geometry.clone();
            hand.geometry.translate(0, len * 0.42, 0);
            hand.position.set(0, 0, z);
        }
    }

    // ---- canvas textures --------------------------------------------------
    _canvasTexture(w, h, draw, flipY = false) {
        const cv = document.createElement('canvas');
        cv.width = w;
        cv.height = h;
        draw(cv.getContext('2d'), w, h);
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        tex.flipY = flipY;   // pages authored v0=top (glTF style); banner v1=top
        return tex;
    }

    _pageMaterial(tex) {
        return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
    }

    _bookPage(title, drawBody) {
        // reader stands north of the bar: 180° canvas (exporter V-flip +
        // west-ward reading direction)
        return this._canvasTexture(512, 768, (c, w, h) => {
            paper(c, w, h);
            c.translate(w, h);
            c.rotate(Math.PI);
            c.fillStyle = '#3a2c1c';
            c.font = '700 42px Anybody, Geist, sans-serif';
            c.fillText(title, 56, 96);
            c.strokeStyle = '#8a6b47';
            c.lineWidth = 2;
            line(c, 56, 118, w - 56, 118);
            drawBody(c, w, h);
        });
    }

    _paintBook() {
        this.pageL = this.scene.getObjectByName('WP3_MenuBook_Page_L');
        this.pageR = this.scene.getObjectByName('WP3_MenuBook_Page_R');
        if (!this.pageL || !this.pageR) return;
        const body = (text) => (c) => {
            c.font = '400 26px Geist, sans-serif';
            c.fillStyle = '#33261a';
            wrapLines(text, 30).forEach((ln, i) => c.fillText(ln, 56, 182 + i * 37));
        };
        const resumeBody = (entries) => (c) => {
            let y = 176;
            for (const [when, what, where] of entries) {
                c.font = '700 21px Geist Mono, Geist, monospace';
                c.fillStyle = '#7a5a34';
                c.fillText(when, 56, y);
                c.font = '600 26px Geist, sans-serif';
                c.fillStyle = '#33261a';
                c.fillText(what, 56, y + 30);
                c.font = '400 22px Geist, sans-serif';
                c.fillStyle = '#5b4630';
                c.fillText(where, 56, y + 58);
                y += 92;
            }
        };
        // spreads flip as you keep scrolling at the bar (reader-left = _R)
        this.bookSpreads = [
            [this._bookPage('ÜBER MICH', body(ABOUT_P1)),
             this._bookPage('', body(ABOUT_P2))],
            [this._bookPage('LEBENSLAUF', resumeBody(RESUME.slice(0, 4))),
             this._bookPage('', resumeBody(RESUME.slice(4)))],
        ];
        this.bookIdx = -1;
        this._setSpread(0);
    }

    _setSpread(idx) {
        if (idx === this.bookIdx || !this.bookSpreads) return;
        this.bookIdx = idx;
        const [texL, texR] = this.bookSpreads[idx];
        this.pageR.material = this._pageMaterial(texL);   // reader-left
        this.pageL.material = this._pageMaterial(texR);   // reader-right
    }

    _paintBanner() {
        this.banner = this.scene.getObjectByName('WP1_Banner');
        if (!this.banner) return;
        // authored U runs viewer-left; flip it so the canvas reads normally
        const uv = this.banner.geometry.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
        uv.needsUpdate = true;
        // choreography state: rolled up until the first scroll, rolled back
        // up again shortly before the camera passes through the archway
        const dict = this.banner.morphTargetDictionary || {};
        this.bannerMorph = 'Rolled' in dict ? dict.Rolled : 0;
        this.bannerInf = 1.0;
        this.banner.morphTargetInfluences[this.bannerMorph] = 1.0;
        const p = new THREE.Vector3();
        this.banner.getWorldPosition(p);
        this.uBanner = this.rig.uOfPoint(p);
        const img = new Image();
        img.onload = () => {
            const tex = this._canvasTexture(1024, 1490, (c, w, h) => {
                c.fillStyle = '#6d1f1a';
                c.fillRect(0, 0, w, h);
                c.fillStyle = '#7d2a22';
                for (let i = 0; i < h; i += 26) c.fillRect(0, i, w, 4);
                c.strokeStyle = '#caa24a';
                c.lineWidth = 14;
                c.strokeRect(36, 36, w - 72, h - 72);
                const s = Math.min((w - 260) / img.width, 470 / img.height);
                const iw = img.width * s;
                const ih = img.height * s;
                c.save();
                c.beginPath();
                c.rect((w - iw) / 2, 92, iw, ih);
                c.clip();
                c.drawImage(img, (w - iw) / 2, 92, iw, ih);
                c.restore();
                c.strokeStyle = '#caa24a';
                c.lineWidth = 6;
                c.strokeRect((w - iw) / 2, 92, iw, ih);
                c.fillStyle = '#e8d9b0';
                c.textAlign = 'center';
                c.font = '900 84px Anybody, Geist, sans-serif';
                c.fillText('DENNIS MÜNCH', w / 2, 660);
                c.strokeStyle = '#caa24a';
                c.lineWidth = 3;
                line(c, w / 2 - 220, 696, w / 2 + 220, 696);
                c.font = '400 33px Geist, sans-serif';
                wrapLines(START_TEXT, 52).forEach((ln, i) => {
                    c.fillText(ln, w / 2, 762 + i * 46);
                });
                c.font = 'italic 400 36px Geist, sans-serif';
                c.fillText('So long, Dennis Münch', w / 2, h - 92);
        }, false);
            this.banner.material = new THREE.MeshStandardMaterial({
                map: tex, roughness: 0.9, side: THREE.DoubleSide,
            });
        };
        img.src = './images/dennis_muench_portrait.jpg';
    }

    // ---- triggers / position anchors --------------------------------------
    _setupTriggers() {
        if (this.batwingL) {
            const p = new THREE.Vector3();
            this.batwingL.getWorldPosition(p);
            this.uBatwing = this.rig.uOfPoint(p);
        }
        if (this.turnstile) {
            const p = new THREE.Vector3();
            this.turnstile.getWorldPosition(p);
            this.uTurnstile = this.rig.uOfPoint(p);
        }
    }

    _play(name) {
        const action = this.actions[name];
        if (action) action.reset().play();
    }

    // ---- pointer ----------------------------------------------------------
    _bindPointer() {
        let downAt = null;
        this.dom.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
        this.dom.addEventListener('pointerup', (e) => {
            if (!downAt) return;
            const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
            downAt = null;
            if (moved < 6 && this.hovered) this._activate(this.hovered);
        });
        this.dom.addEventListener('pointermove', (e) => {
            this.pointer.set(
                (e.clientX / window.innerWidth) * 2 - 1,
                -(e.clientY / window.innerHeight) * 2 + 1,
            );
        });
    }

    _activate(obj) {
        const id = obj.userData.link_id;
        const page = obj.userData.page;
        if (id && LINKS[id]) {
            const l = LINKS[id];
            if (l.toast) this.toast(l.toast);
            else if (l.ext) window.open(l.url, '_blank', 'noopener');
            else window.location.href = l.url;
        } else if (page === 'bio' || page === 'resume') {
            // canvases are swapped relative to the baked page prop (reader view)
            this.toast(obj.name.endsWith('_R') ? 'Kurzbiografie' : 'Lebenslauf');
        } else if (obj.userData.interactive_type === 'banner') {
            this.toast('Dennis Münch — willkommen!');
        }
    }

    _bindNav() {
        document.querySelectorAll('#wp-nav button').forEach((btn) => {
            btn.addEventListener('click', () => this.rig.goToStop(btn.dataset.wp));
        });
    }

    toast(msg) {
        this.toastEl.textContent = msg;
        this.toastEl.classList.add('visible');
        clearTimeout(this._toastT);
        this._toastT = setTimeout(() => this.toastEl.classList.remove('visible'), 2200);
    }

    // ---- per-frame --------------------------------------------------------
    update(dt) {
        const u = this.rig.u;

        // Position-driven (scrubbed) animations in relation to viewer position
        // 1. Saloon batwing doors: open wide to 95 degrees, HOLD FULLY WIDE OPEN STILL while passing through, close behind
        if (this.batwingL && this.batwingR && this.uBatwing !== undefined) {
            let du = ((u - this.uBatwing) % 1 + 1) % 1;
            if (du > 0.5) du -= 1;
            let p = 0;
            if (du >= -0.040 && du < -0.008) {
                p = smoothstep((du + 0.040) / 0.032);
            } else if (du >= -0.008 && du <= 0.025) {
                p = 1.0; // FULLY 100% WIDE OPEN (95 DEGREES) AND STILL WHILE PASSING THROUGH
            } else if (du > 0.025 && du <= 0.057) {
                p = smoothstep(1 - (du - 0.025) / 0.032);
            } else {
                p = 0;
            }
            const angleL = -1.65 * p; // ~95 degrees wide open
            const angleR = 1.65 * p;
            this.batwingL.quaternion.copy(this.qL_init).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angleL));
            this.batwingR.quaternion.copy(this.qR_init).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angleR));
        }

        // 2. Metro turnstile spins as viewer walks through. The offset used to
        // be folded into `d` as well as into `p`, which put the whole 0.03 window
        // *before* the gate: it had finished its click 0.01 u short of the rotor
        // and stood still as you walked through it. Measure d from the rotor and
        // the window straddles it (-0.020 .. +0.010) the way it reads.
        if (this.actions['turnstile_spin'] && this.uTurnstile !== undefined) {
            let d = ((u - this.uTurnstile) % 1 + 1) % 1;
            if (d > 0.5) d -= 1;
            const p = Math.max(0, Math.min(1, (d + 0.020) / 0.030));
            const action = this.actions['turnstile_spin'];
            action.time = p * action.getClip().duration;
        }

        // 3. Metro train doors of both DT1 cars: scrubbed in TrainRide.js, which
        // owns the whole close-cut-open cycle around the teleport.

        // 4. Atrium Banner: stays unrolled through atrium, rolls up right as you pass under archway
        if (this.banner) {
            const ahead = ((this.uBanner - u) % 1 + 1) % 1;
            let p = 1.0; // default rolled up (eingefahren)
            if (ahead >= 0.18 && ahead <= 0.30) {
                p = (ahead - 0.18) / 0.12; // unrolling 1 -> 0 on approach
            } else if (ahead >= 0.05 && ahead < 0.18) {
                p = 0.0; // STAY FULLY UNROLLED during atrium walk
            } else if (ahead >= 0.00 && ahead < 0.05) {
                p = (0.05 - ahead) / 0.05; // roll up right before archway
            } else {
                p = 1.0; // eingefahren when under/past archway
            }
            p = Math.max(0, Math.min(1, p));
            this.bannerInf = p;
            this.banner.morphTargetInfluences[this.bannerMorph] = this.bannerInf;
            if (this.actions['banner_drop']) {
                const action = this.actions['banner_drop'];
                action.time = (1 - p) * action.getClip().duration;
            }
        }

        for (const b of this.billboards) {
            if (b.parent) {
                b.parent.getWorldQuaternion(this._tmpParentQ);
                this._tmpTargetQ.copy(this._tmpParentQ).invert().multiply(this.camera.quaternion).multiply(this._billboardOffsetQ);
                b.quaternion.copy(this._tmpTargetQ);
            } else {
                b.quaternion.copy(this.camera.quaternion).multiply(this._billboardOffsetQ);
            }
        }

        if (this.clock.second) {
            const now = new Date();
            const s = now.getSeconds() + now.getMilliseconds() / 1000;
            const mnt = now.getMinutes() + s / 60;
            const hr = (now.getHours() % 12) + mnt / 60;
            this.clock.second.rotation.z = -s * (Math.PI / 30);
            this.clock.minute.rotation.z = -mnt * (Math.PI / 30);
            this.clock.hour.rotation.z = -hr * (Math.PI / 6);
        }

        // hover raycast (throttled)
        this._rayT = (this._rayT || 0) + dt;
        if (this._rayT > 0.08) {
            this._rayT = 0;
            this.raycaster.setFromCamera(this.pointer, this.camera);
            const hits = this.raycaster.intersectObjects(this.clickables, true);
            let target = null;
            if (hits.length) {
                let o = hits[0].object;
                while (o && !(o.userData && o.userData.interactive_type)) o = o.parent;
                if (o && hits[0].distance < 40) target = o;
            }
            if (target !== this.hovered) {
                this.hovered = target;
                document.body.style.cursor = target ? 'pointer' : '';
            }
        }

        // waypoint title + nav highlight
        const near = this.rig.nearestStop();
        const title = near ? WP_TITLES[near.name] : null;
        if (title !== this._lastTitle) {
            this._lastTitle = title;
            if (title) {
                this.titleEl.textContent = title;
                this.titleEl.classList.add('visible');
            } else {
                this.titleEl.classList.remove('visible');
            }
        }
        const activeWp = near ? near.name.replace('projects_boat', 'projects').replace('contact_inside', 'contact') : null;
        this.navEl.querySelectorAll('button').forEach((b) => {
            b.classList.toggle('active', b.dataset.wp === activeWp);
        });
    }
}

function smoothstep(x) {
    const t = Math.max(0, Math.min(1, x));
    return t * t * (3 - 2 * t);
}

function crossed(a, b, x) {
    if (Math.abs(b - a) > 0.5) return false;     // ignore the loop-seam jump
    return (a < x && b >= x) || (b < x && a >= x);
}

function paper(c, w, h) {
    c.fillStyle = '#efe6d2';
    c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(120, 90, 50, 0.05)';
    for (let i = 0; i < 40; i++) {
        c.fillRect(Math.random() * w, Math.random() * h, 60 + Math.random() * 120, 1.2);
    }
}

function line(c, x0, y0, x1, y1) {
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
    c.stroke();
}
