import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9223;
const TARGET_URL = 'http://localhost:8123/mansion/index.html?dev=1';

async function main() {
    const shotDir = join(process.cwd(), 'blender', 'output', 'webshots');
    await mkdir(shotDir, { recursive: true });

    console.log('[Test] Launching Edge headless...');
    const edgeProc = spawn(EDGE_PATH, [
        '--headless=new',
        `--remote-debugging-port=${PORT}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--autoplay-policy=no-user-gesture-required',
        '--window-size=1600,1000',
        '--disable-gpu-watchdog',
        TARGET_URL
    ], { stdio: 'ignore' });

    edgeProc.on('error', (err) => {
        console.error('Failed to spawn Edge:', err);
        process.exit(1);
    });

    let wsUrl = null;
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 400));
        try {
            const res = await fetch(`http://127.0.0.1:${PORT}/json`);
            if (res.ok) {
                const list = await res.json();
                const page = list.find(t => t.type === 'page');
                if (page && page.webSocketDebuggerUrl) {
                    wsUrl = page.webSocketDebuggerUrl;
                    break;
                }
            }
        } catch (e) {}
    }

    if (!wsUrl) {
        console.error('[Test] Could not connect to Edge DevTools');
        edgeProc.kill();
        process.exit(1);
    }

    console.log('[Test] Connected to CDP:', wsUrl);
    const ws = new WebSocket(wsUrl);

    let nextId = 1;
    const pending = new Map();
    const consoleLogs = [];

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
        }
        if (msg.method === 'Runtime.consoleAPICalled') {
            const args = (msg.params.args || []).map(a => a.value || JSON.stringify(a)).join(' ');
            consoleLogs.push(`[Browser ${msg.params.type}] ${args}`);
        }
    };

    function send(method, params = {}) {
        return new Promise((resolve) => {
            const id = nextId++;
            pending.set(id, resolve);
            ws.send(JSON.stringify({ id, method, params }));
        });
    }

    await new Promise(r => ws.onopen = r);

    await send('Runtime.enable');
    await send('Page.enable');

    console.log('[Test] Waiting for page and 3D world to initialize...');
    let ready = false;
    for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 500));
        const res = await send('Runtime.evaluate', {
            expression: 'Boolean(window.__teleport)',
            returnByValue: true
        });
        if (res.result && res.result.result && res.result.result.value) {
            ready = true;
            break;
        }
    }

    if (!ready) {
        console.error('[Test] Timeout waiting for world initialization');
        console.log('Console logs:', consoleLogs.slice(-15));
        edgeProc.kill();
        process.exit(1);
    }

    console.log('[Test] 3D World ready. Waiting 2.5s for PBR textures to load...');
    await new Promise(r => setTimeout(r, 2500));

    // Shot 1: Courtyard Outer Wall (Big Ring)
    console.log('[Test] Teleporting to view Courtyard Outer Wall (Big Ring)...');
    await send('Runtime.evaluate', {
        expression: 'window.__teleport(0, 1.75, 12, 0, 2.4, 24);'
    });
    await new Promise(r => setTimeout(r, 1200));

    const shot1 = await send('Page.captureScreenshot', { format: 'png' });
    if (shot1.result && shot1.result.data) {
        const p1 = join(shotDir, 'plaster_courtyard_ring.png');
        await writeFile(p1, Buffer.from(shot1.result.data, 'base64'));
        console.log('[Test] Saved courtyard ring screenshot to:', p1);
    }

    // Shot 2: Room Outer Wall (e.g. Arbeit room outer cylinder)
    console.log('[Test] Teleporting to view Room Outer Wall from Courtyard...');
    await send('Runtime.evaluate', {
        expression: 'window.__teleport(0, 1.75, -8, 0, 2.2, -16.5);'
    });
    await new Promise(r => setTimeout(r, 1200));

    const shot2 = await send('Page.captureScreenshot', { format: 'png' });
    if (shot2.result && shot2.result.data) {
        const p2 = join(shotDir, 'plaster_room_outer.png');
        await writeFile(p2, Buffer.from(shot2.result.data, 'base64'));
        console.log('[Test] Saved room outer wall screenshot to:', p2);
    }

    // Shot 3: Room Inner Wall (Inside Arbeit room)
    console.log('[Test] Teleporting inside Arbeit room to view Inner Plaster Wall...');
    await send('Runtime.evaluate', {
        expression: 'window.__teleport(0, 1.75, -16.5, 0, 2.2, -22.0);'
    });
    await new Promise(r => setTimeout(r, 1200));

    const shot3 = await send('Page.captureScreenshot', { format: 'png' });
    if (shot3.result && shot3.result.data) {
        const p3 = join(shotDir, 'plaster_room_inner.png');
        await writeFile(p3, Buffer.from(shot3.result.data, 'base64'));
        console.log('[Test] Saved room inner wall screenshot to:', p3);
    }

    console.log('[Test] All plaster verification screenshots captured successfully!');
    ws.close();
    edgeProc.kill();
    process.exit(0);
}

main().catch(err => {
    console.error('[Test Error]', err);
    process.exit(1);
});
