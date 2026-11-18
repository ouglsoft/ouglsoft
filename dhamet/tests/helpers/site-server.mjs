// Serves the site the way the deployment lays it out (site/ with shared/ next to it, and the
// cache-busting token replaced), from a temporary copy, on a free local port.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// DHAMET_ROOT points the tests at another copy of the code (e.g. to confirm a test fails on the old version).
const root = process.env.DHAMET_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function stage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhamet-site-'));
  fs.cpSync(path.join(root, 'site'), dir, { recursive: true });
  fs.cpSync(path.join(root, 'shared'), path.join(dir, 'shared'), { recursive: true });
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(html|js)$/.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8');
        if (text.includes('__DHAMET_BUILD__')) fs.writeFileSync(full, text.replaceAll('__DHAMET_BUILD__', 'test'));
      }
    }
  };
  walk(dir);
  return dir;
}

export async function serveSite() {
  const dir = stage();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file = path.normalize(path.join(dir, decodeURIComponent(url.pathname)));
    if (!file.startsWith(dir)) { res.writeHead(403); res.end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const close = async () => { await new Promise((resolve) => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); };
  return { origin, dir, close };
}
