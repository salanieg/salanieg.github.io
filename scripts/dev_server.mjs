// Zero-dependency static dev server for local preview:  node scripts/dev_server.mjs [port]
// Dev-only extra: POST /__shot?name=foo with a data-URL body saves a JPEG to
// blender/output/webshots/foo.jpg (used for automated visual checks).
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.argv[2] || process.env.PORT || 8123);
const ROOT = process.cwd();
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.glb': 'model/gltf-binary',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
    '.mp3': 'audio/mpeg', '.pdf': 'application/pdf', '.webmanifest': 'application/manifest+json',
};

createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://x');
        if (req.method === 'POST' && url.pathname === '/__shot') {
            const name = (url.searchParams.get('name') || 'shot').replace(/[^\w-]/g, '');
            let body = '';
            for await (const chunk of req) body += chunk;
            const b64 = body.replace(/^data:image\/\w+;base64,/, '');
            const dir = join(ROOT, 'blender', 'output', 'webshots');
            await mkdir(dir, { recursive: true });
            await writeFile(join(dir, `${name}.jpg`), Buffer.from(b64, 'base64'));
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('ok');
            return;
        }
        let path = decodeURIComponent(url.pathname);
        if (path.endsWith('/')) path += 'index.html';
        const file = normalize(join(ROOT, path));
        if (!file.startsWith(normalize(ROOT))) throw new Error('traversal');
        const data = await readFile(file);
        res.writeHead(200, {
            'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store',
        });
        res.end(data);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404');
    }
}).listen(PORT, () => console.log(`dev server on http://localhost:${PORT}`));
