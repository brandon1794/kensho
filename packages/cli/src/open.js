// kensho open — serve a generated report on a local port + open it.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, resolve, normalize } from 'node:path';
import { exec } from 'node:child_process';

const MIME = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'application/javascript; charset=utf-8', '.mjs':'application/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.webp':'image/webp', '.webm':'video/webm', '.mp4':'video/mp4',
  '.zip':'application/zip', '.txt':'text/plain; charset=utf-8',
  '.log':'text/plain; charset=utf-8', '.har':'application/json',
};

export async function openReport({ report, port }) {
  if (!existsSync(report)) throw new Error(`report directory not found: ${report}`);
  if (!existsSync(join(report, 'index.html'))) {
    throw new Error(`${report}/index.html is missing — run 'kensho generate' first`);
  }

  const server = createServer(async (req, res) => {
    try {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
      // Safety: resolve inside the report root, reject traversal.
      const full = normalize(join(report, urlPath));
      if (!full.startsWith(resolve(report))) {
        res.writeHead(403); res.end('forbidden'); return;
      }
      const s = existsSync(full) ? await stat(full) : null;
      const target = s?.isDirectory() ? join(full, 'index.html') : full;
      if (!existsSync(target)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found: ' + urlPath);
        return;
      }
      const data = await readFile(target);
      res.writeHead(200, {
        'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('server error: ' + err.message);
    }
  });

  await new Promise(r => server.listen(port || 0, '127.0.0.1', r));
  const addr = server.address();
  const url = `http://127.0.0.1:${addr.port}/`;
  console.log(`[kensho] serving ${report}`);
  console.log(`[kensho] → ${url}`);

  // Best-effort open in the default browser on macOS/Linux/Windows.
  const cmd =
    process.platform === 'darwin' ? `open "${url}"`
    : process.platform === 'win32' ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {});

  // Stay alive until interrupted.
  console.log('[kensho] press Ctrl+C to stop');
  process.on('SIGINT', () => {
    server.close(() => { console.log('\n[kensho] stopped'); process.exit(0); });
  });
}
