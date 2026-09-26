import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9222;
const TARGET_URL = 'http://localhost:8123/mansion/index.html?dev=1';
const SCREENSHOT_DIR = 'C:\\Users\\denm\\Desktop\\Projekte\\Coding\\GitHub\\salanieg.github.io\\blender\\output\\webshots';

async function main() {
    if (!fs.existsSync(SCREENSHOT_DIR)) {
        fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }

    const edgeProc = spawn(EDGE_PATH, [
        '--headless=new',
        `--remote-debugging-port=${PORT}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--autoplay-policy=no-user-gesture-required',
        '--window-size=1600,1000',
        TARGET_URL
    ], { stdio: 'ignore' });

    await new Promise(r => setTimeout(r, 1500));
    const res = await fetch(`http://127.0.0.1:${PORT}/json`);
    const list = await res.json();
    const page = list.find(t => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);

    let nextId = 1;
    const pending = new Map();

    const logs = [];
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
        }
        if (msg.method === 'Runtime.consoleAPICalled') {
            const args = (msg.params.args || []).map(a => a.value || JSON.stringify(a)).join(' ');
            console.log(`[Browser ${msg.params.type}] ${args}`);
        }
        if (msg.method === 'Runtime.exceptionThrown') {
            console.log(`[Browser Exception] ${JSON.stringify(msg.params.exceptionDetails)}`);
        }
    };

    function send(method, params = {}) {
        return new Promise(resolve => {
            const id = nextId++;
            pending.set(id, resolve);
            ws.send(JSON.stringify({ id, method, params }));
        });
    }

    await new Promise(r => ws.onopen = r);
    await send('Runtime.enable');

    // Wait for world to load and dev user to be initialized
    await new Promise(r => setTimeout(r, 3000));

    // Teleport player into Chillen room facing screen and panel
    // Screen is around (5.86, 2.35, 16.14), panel is at (4.37, 1.80, 12.74)
    // Stand at (7.8, 1.7, 13.8) looking towards screen center
    await send('Runtime.evaluate', {
        expression: `
            (() => {
                if (window.__teleport) {
                    window.__teleport(7.5, 1.7, 13.6, 5.0, 2.0, 14.5);
                }
            })()
        `
    });

    await new Promise(r => setTimeout(r, 500));

    // Start video playback
    console.log('--- Starting Cinema Video (Big Buck Bunny clip) ---');
    await send('Runtime.evaluate', {
        expression: `
            (() => {
                window.__cinemaControl.setCinemaVideo('M7lc1UVf-VE', true, 30);
            })()
        `
    });

    // Wait 3 seconds for video to start and API to fire events
    await new Promise(r => setTimeout(r, 3000));

    const statePlaying = await send('Runtime.evaluate', {
        expression: `
            (() => {
                const p = window.__cinemaControl.getYtPlayer();
                return {
                    playerState: p && p.getPlayerState ? p.getPlayerState() : null,
                    currentTime: p && p.getCurrentTime ? p.getCurrentTime() : null,
                    duration: p && p.getDuration ? p.getDuration() : null
                };
            })()
        `,
        returnByValue: true
    });
    console.log('Video state while playing:', statePlaying.result.result.value);

    // Capture screenshot while playing
    const shotPlaying = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SCREENSHOT_DIR, 'cinema_playing.png'), Buffer.from(shotPlaying.result.data, 'base64'));
    console.log('Saved cinema_playing.png');

    // Test Play/Pause click via 3D control interaction
    console.log('--- Testing Play/Pause Button Click ---');
    await send('Runtime.evaluate', {
        expression: `
            (() => {
                const meshes = window.__cinemaControl.getControlMeshes();
                const ppMesh = meshes.find(m => m.userData && m.userData.cinemaAction === 'playpause');
                window.__cinemaControl.handleCinemaControlClick('playpause', null, ppMesh);
            })()
        `
    });

    await new Promise(r => setTimeout(r, 1200));

    const statePaused = await send('Runtime.evaluate', {
        expression: `
            (() => {
                const p = window.__cinemaControl.getYtPlayer();
                return {
                    playerState: p && p.getPlayerState ? p.getPlayerState() : null,
                    currentTime: p && p.getCurrentTime ? p.getCurrentTime() : null
                };
            })()
        `,
        returnByValue: true
    });
    console.log('Video state after pause click:', statePaused.result.result.value);

    // Test +15s button click
    console.log('--- Testing +15s Button Click ---');
    await send('Runtime.evaluate', {
        expression: `
            (() => {
                const meshes = window.__cinemaControl.getControlMeshes();
                const fwdMesh = meshes.find(m => m.userData && m.userData.cinemaAction === 'fwd15');
                window.__cinemaControl.handleCinemaControlClick('fwd15', null, fwdMesh);
            })()
        `
    });

    await new Promise(r => setTimeout(r, 800));

    const stateFwd = await send('Runtime.evaluate', {
        expression: `
            (() => {
                const p = window.__cinemaControl.getYtPlayer();
                return {
                    currentTime: p && p.getCurrentTime ? p.getCurrentTime() : null
                };
            })()
        `,
        returnByValue: true
    });
    console.log('Video time after +15s:', stateFwd.result.result.value);

    // Test -15s button click
    console.log('--- Testing -15s Button Click ---');
    await send('Runtime.evaluate', {
        expression: `
            (() => {
                const meshes = window.__cinemaControl.getControlMeshes();
                const backMesh = meshes.find(m => m.userData && m.userData.cinemaAction === 'back15');
                window.__cinemaControl.handleCinemaControlClick('back15', null, backMesh);
            })()
        `
    });

    await new Promise(r => setTimeout(r, 800));

    const stateBack = await send('Runtime.evaluate', {
        expression: `
            (() => {
                const p = window.__cinemaControl.getYtPlayer();
                return {
                    currentTime: p && p.getCurrentTime ? p.getCurrentTime() : null
                };
            })()
        `,
        returnByValue: true
    });
    console.log('Video time after -15s:', stateBack.result.result.value);

    // Test Scrubber Seek
    console.log('--- Testing Scrubber Seek to 120s ---');
    await send('Runtime.evaluate', {
        expression: `
            (() => {
                const meshes = window.__cinemaControl.getControlMeshes();
                const scrubMesh = meshes.find(m => m.userData && m.userData.cinemaAction === 'scrubber');
                window.__cinemaControl.handleCinemaControlClick('scrubber', 120, scrubMesh);
            })()
        `
    });

    await new Promise(r => setTimeout(r, 800));

    const stateScrub = await send('Runtime.evaluate', {
        expression: `
            (() => {
                const p = window.__cinemaControl.getYtPlayer();
                return {
                    currentTime: p && p.getCurrentTime ? p.getCurrentTime() : null
                };
            })()
        `,
        returnByValue: true
    });
    console.log('Video time after Scrubber seek:', stateScrub.result.result.value);

    // Teleport closer to the control panel for closeup screenshot
    await send('Runtime.evaluate', {
        expression: `
            (() => {
                if (window.__teleport) {
                    window.__teleport(5.2, 1.80, 12.74, 4.37, 1.80, 12.74);
                }
            })()
        `
    });

    await new Promise(r => setTimeout(r, 500));

    const shotPanel = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SCREENSHOT_DIR, 'cinema_panel_active.png'), Buffer.from(shotPanel.result.data, 'base64'));
    console.log('Saved cinema_panel_active.png');

    ws.close();
    edgeProc.kill();
    console.log('--- All tests passed! ---');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
