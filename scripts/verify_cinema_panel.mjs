import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9222;
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
            expression: 'Boolean(window.__cinemaControl && window.__cinemaControl.isReady && window.__cinemaControl.isReady())',
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

    console.log('[Test] 3D World ready. Checking control panel meshes...');
    const meshesRes = await send('Runtime.evaluate', {
        expression: `
            (() => {
                const meshes = window.__cinemaControl.getControlMeshes();
                return {
                    count: meshes.length,
                    actions: meshes.map(m => m.userData.action),
                    prompts: meshes.map(m => m.userData.promptText)
                };
            })()
        `,
        returnByValue: true
    });
    console.log('[Test] Control meshes info:', meshesRes.result.result.value);

    // 1. Blick auf Leinwand und das Bedienpult rechts an der Wand
    console.log('[Test] Teleporting camera to view screen and control panel on the right...');
    await send('Runtime.evaluate', {
        expression: `
            // Kamera platziert im Chillen-Raum: Screen links, Bedienpult rechts
            window.__teleport(11.6, 1.85, 14.5, 5.0, 2.10, 14.5);
        `
    });

    await new Promise(r => setTimeout(r, 1500));

    console.log('[Test] Capturing screenshot 1 (Idle - Screen & Panel to the right)...');
    const shot1 = await send('Page.captureScreenshot', { format: 'png' });
    if (shot1.result && shot1.result.data) {
        const buf = Buffer.from(shot1.result.data, 'base64');
        const p1 = join(shotDir, 'cinema_idle.png');
        await writeFile(p1, buf);
        console.log('[Test] Saved idle screenshot to:', p1);
    }

    // 2. Frontale Nahaufnahme des Bedienpults an der Wand
    console.log('[Test] Teleporting closer to control panel...');
    await send('Runtime.evaluate', {
        expression: `
            // Direkt vor dem Bedienpult
            window.__teleport(6.05, 1.80, 12.95, 4.37, 1.80, 12.74);
        `
    });
    await new Promise(r => setTimeout(r, 1000));
    const shotPanel = await send('Page.captureScreenshot', { format: 'png' });
    if (shotPanel.result && shotPanel.result.data) {
        const buf = Buffer.from(shotPanel.result.data, 'base64');
        const pPanel = join(shotDir, 'cinema_panel_closeup.png');
        await writeFile(pPanel, buf);
        console.log('[Test] Saved panel closeup screenshot to:', pPanel);
    }

    // 3. Test: Video starten (YouTube API)
    console.log('[Test] Setting video ID and playing state via setCinemaVideo...');
    await send('Runtime.evaluate', {
        expression: `
            window.__cinemaControl.setCinemaVideo('M7lc1UVf-VE', true, 20);
        `
    });

    await new Promise(r => setTimeout(r, 3000));

    // Check DOM and playback state
    const stateRes = await send('Runtime.evaluate', {
        expression: `
            (() => {
                const wrapper = document.getElementById('cinema-inworld-wrapper');
                const iframe = document.getElementById('cinema-iframe-id');
                return {
                    wrapperOpacity: wrapper ? wrapper.style.opacity : null,
                    iframeTagName: iframe ? iframe.tagName : null,
                    iframeSrc: iframe ? iframe.src : null,
                    isPlayerActive: Boolean(window.ytPlayer)
                };
            })()
        `,
        returnByValue: true
    });
    console.log('[Test] Cinema in-world DOM state:', stateRes.result.result.value);

    // Zoom back out to overview view
    await send('Runtime.evaluate', {
        expression: `
            window.__teleport(11.6, 1.85, 14.5, 5.0, 2.10, 14.5);
        `
    });
    await new Promise(r => setTimeout(r, 1500));

    // Screenshot 3: Active Video Playback & Updated Panel
    console.log('[Test] Capturing screenshot 3 (Playing)...');
    const shot2 = await send('Page.captureScreenshot', { format: 'png' });
    if (shot2.result && shot2.result.data) {
        const buf = Buffer.from(shot2.result.data, 'base64');
        const p2 = join(shotDir, 'cinema_playing.png');
        await writeFile(p2, buf);
        console.log('[Test] Saved playing screenshot to:', p2);
    }

    console.log('[Test] Recent browser console logs:');
    consoleLogs.slice(-15).forEach(l => console.log('  ', l));

    edgeProc.kill();
    ws.close();
    console.log('[Test] Completed successfully!');
    process.exit(0);
}

main().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
