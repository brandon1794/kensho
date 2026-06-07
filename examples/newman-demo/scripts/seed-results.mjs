// Drives newman-reporter-kensho with a tiny Newman-like event emitter so the
// demo works without installing Newman or hitting the network.

import { EventEmitter } from 'node:events';
import { rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const KenshoNewmanReporter = require('newman-reporter-kensho');

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
process.chdir(projectRoot);

const output = resolve(projectRoot, 'kensho-results');
try { rmSync(output, { recursive: true, force: true }); } catch {}

// Minimal Postman PropertyList shim: anything with .all() returning an array.
function pl(arr) { return { all: () => arr || [] }; }

// Build a parent chain so reporter's parent() walk produces folders.
function makeFolder(name, parent, items) {
  const folder = {
    name,
    parent: () => parent,
  };
  // attach children's parent pointer
  for (const it of items || []) it._parent = folder;
  return folder;
}

function makeRequest(method, url, body, headers) {
  return {
    method,
    url: { toString: () => url, raw: url },
    headers: pl((headers || []).map(([key, value]) => ({ key, value }))),
    body: body ? { mode: 'raw', raw: body } : undefined,
  };
}

function makeResponse(code, status, body, headers, sizeBytes) {
  return {
    code,
    status,
    stream: Buffer.from(body || ''),
    body,
    headers: pl((headers || []).map(([key, value]) => ({ key, value }))),
    size: () => ({ total: sizeBytes || (body ? body.length : 0) }),
  };
}

const collection = {
  name: 'Acme API',
  info: { name: 'Acme API' },
};

const authFolder = { name: '@critical/Auth' };
const catalogFolder = { name: 'Catalog' };
const collectionRoot = { name: 'Acme API', parent: () => null };
authFolder.parent = () => collectionRoot;
catalogFolder.parent = () => collectionRoot;

const items = [
  {
    item: { name: 'POST /login (valid creds)', parent: () => authFolder },
    request: makeRequest('POST', 'https://httpbin.org/anything/login',
      '{"email":"alice@example.com","password":"hunter2"}',
      [['Content-Type', 'application/json']]),
    response: makeResponse(200, 'OK',
      '{"args":{},"data":"{\\"email\\":\\"alice@example.com\\"}","headers":{"Host":"httpbin.org"},"json":{"email":"alice@example.com"},"url":"https://httpbin.org/anything/login"}',
      [['Content-Type', 'application/json'], ['Server', 'gunicorn/19.9.0']],
      256),
    assertions: [
      { name: 'status is 200', skipped: false, error: null },
      { name: 'returns json', skipped: false, error: null },
    ],
  },
  {
    item: { name: 'GET /products', parent: () => catalogFolder },
    request: makeRequest('GET', 'https://httpbin.org/anything/products', null, []),
    response: makeResponse(200, 'OK',
      '{"args":{},"products":[{"id":1,"name":"Widget"}]}',
      [['Content-Type', 'application/json']],
      96),
    assertions: [
      { name: 'status is 200', skipped: false, error: null },
      { name: 'body contains products array', skipped: false, error: null },
    ],
  },
  {
    item: { name: 'GET /products/missing @minor', parent: () => catalogFolder },
    request: makeRequest('GET', 'https://httpbin.org/status/404', null, []),
    response: makeResponse(404, 'Not Found', '', [['Content-Type', 'text/plain']], 0),
    assertions: [
      {
        name: 'returns 404',
        skipped: false,
        error: {
          name: 'AssertionError',
          message: 'expected 404 to equal 200',
          expected: 200,
          actual: 404,
          stack: 'AssertionError: expected 404 to equal 200\n  at Test',
        },
      },
    ],
  },
];

const emitter = new EventEmitter();
const reporterOptions = { projectName: 'Acme API', projectSlug: 'acme-api', output };
const collectionRunOptions = { collection, newmanVersion: '6.0.0' };

new KenshoNewmanReporter(emitter, reporterOptions, collectionRunOptions);

emitter.emit('start', null, {});

for (let i = 0; i < items.length; i++) {
  const it = items[i];
  const cursor = { ref: `cursor-${i}`, position: i, iteration: 0 };
  emitter.emit('beforeItem', null, { item: it.item, cursor });
  emitter.emit('beforeRequest', null, { item: it.item, request: it.request, cursor });
  await sleep(2);
  emitter.emit('request', null, { item: it.item, request: it.request, response: it.response, cursor });
  for (const a of it.assertions) {
    emitter.emit('assertion', a.error, { assertion: a.name, skipped: a.skipped, cursor });
  }
  emitter.emit('item', null, { item: it.item, cursor });
}

emitter.emit('done', null, { run: { stats: {} } });

console.log('[seed] wrote newman-demo kensho-results');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
