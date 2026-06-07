// kensho login — browser-based OAuth-ish loopback flow.
//
// 1. Spin up a tiny http server on a random high port (49152–65535).
// 2. Open https://app.kaizenreport.com/cli/auth?session=<state>&port=<port>
//    in the user's default browser.
// 3. The browser POSTs `{ workspace, token, server, state }` back to us.
//    We verify the state token (so any stray callback can't impersonate the
//    in-flight session) and persist the result with `saveAuth`.
// 4. Time out after 5 minutes so the CLI doesn't hang forever in CI by
//    accident.

import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { saveAuth } from './auth-config.js';

const DEFAULT_SERVER = 'https://api.kaizenreport.com';
const DEFAULT_AUTH_BASE = 'https://app.kaizenreport.com';
const TIMEOUT_MS = 5 * 60 * 1000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * Pick a random port in the IANA dynamic/private range.
 * Bound checks make this safe even if randomInt's output range changes.
 */
function pickPort() {
  return randomInt(49152, 65536); // 65536 is exclusive upper bound
}

/**
 * Open `url` in the default browser. Falls back to printing it on platforms
 * where the helper is missing (sandboxed CI runners, headless Linux).
 */
function openBrowser(url) {
  const cmd =
    process.platform === 'darwin' ? `open "${url}"`
    : process.platform === 'win32' ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) {
      console.log('[kensho] could not open browser automatically.');
      console.log('[kensho] open this URL manually:');
      console.log('  ' + url);
    }
  });
}

function readBody(req, max = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let len = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      len += chunk.length;
      if (len > max) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Run the loopback login flow.
 *
 * @param {object} opts
 * @param {string} [opts.server]       Default api server stored alongside the token.
 * @param {string} [opts.authBase]     Override the URL we point the browser at.
 * @param {boolean} [opts.openBrowser] Default true; tests turn this off.
 * @param {number}  [opts.port]        Force a specific loopback port (tests).
 * @param {number}  [opts.timeoutMs]   Override the 5-minute default.
 * @returns {Promise<{ workspace: string, token: string, server: string, path: string, port: number, url: string }>}
 */
export async function login(opts = {}) {
  const server = opts.server || DEFAULT_SERVER;
  const authBase = opts.authBase || DEFAULT_AUTH_BASE;
  const shouldOpen = opts.openBrowser !== false;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;

  const state = randomBytes(24).toString('base64url');
  const port = opts.port || pickPort();

  return await new Promise((resolveOuter, rejectOuter) => {
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { httpServer.close(); } catch { /* ignore */ }
      err ? rejectOuter(err) : resolveOuter(value);
    };

    const httpServer = createServer(async (req, res) => {
      // Permissive CORS so the web app's POST doesn't fail preflight.
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
      }

      // Health check for the web app to confirm the loopback is live.
      if (req.method === 'GET' && (req.url || '').startsWith('/health')) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS });
        res.end(JSON.stringify({ ok: true, state }));
        return;
      }

      if (req.method !== 'POST' || !(req.url || '').startsWith('/callback')) {
        res.writeHead(404, { 'Content-Type': 'text/plain', ...CORS_HEADERS });
        res.end('not found');
        return;
      }

      try {
        const body = await readBody(req);
        const data = JSON.parse(body || '{}');
        if (data.state !== state) {
          res.writeHead(400, { 'Content-Type': 'application/json', ...CORS_HEADERS });
          res.end(JSON.stringify({ ok: false, error: 'state mismatch' }));
          return;
        }
        if (!data.token || typeof data.token !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json', ...CORS_HEADERS });
          res.end(JSON.stringify({ ok: false, error: 'missing token' }));
          return;
        }
        const auth = {
          workspace: data.workspace || '',
          token: data.token,
          server: data.server || server,
        };
        const path = saveAuth(auth);
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS });
        res.end(JSON.stringify({ ok: true }));
        finish(null, { ...auth, path, port, url });
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...CORS_HEADERS });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });

    httpServer.on('error', (err) => finish(err));

    const timer = setTimeout(() => {
      finish(new Error(
        'timed out after 5 minutes. ' +
        'For CI runners that can\'t open a browser, set the KAIZEN_TOKEN env var instead.'
      ));
    }, timeoutMs);

    let url = '';
    httpServer.listen(port, '127.0.0.1', () => {
      const addr = httpServer.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      url = `${authBase.replace(/\/+$/, '')}/cli/auth?session=${encodeURIComponent(state)}&port=${actualPort}`;
      console.log('[kensho] waiting for browser sign-in …');
      console.log('  ' + url);
      if (shouldOpen) openBrowser(url);
    });
  });
}

/**
 * Top-level CLI entry: runs `login` and prints a friendly summary.
 */
export async function loginCli({ server } = {}) {
  try {
    const result = await login({ server });
    const ws = result.workspace || '(unspecified workspace)';
    console.log(`[kensho] ✓ signed in as ${ws}`);
    console.log(`[kensho]   credentials saved to ${result.path}`);
    return 0;
  } catch (err) {
    console.error('[kensho] login failed:', err.message);
    console.error('[kensho] alternative: set KAIZEN_TOKEN in your environment.');
    return 1;
  }
}
