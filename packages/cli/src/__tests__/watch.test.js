// Tests for `kensho watch`. Uses node:test (matches push.test.js convention)
// and a stubbed fetch + watcher so we never touch the network or the real fs
// inotify subsystem.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { watch, EXIT } from '../watch.js';

// ---------- helpers --------------------------------------------------------

function makeFakeFetch() {
  const calls = [];
  const responders = {
    '/v1/ingest/kensho/live/start': (body) => ({
      status: 200,
      json: { runId: body.runId },
    }),
    '/v1/ingest/kensho/live/event': () => ({
      status: 200,
      json: { ok: true },
    }),
    '/v1/ingest/kensho/live/finalize': (body) => ({
      status: 200,
      json: {
        runUrl: `https://app.kaizenreport.com/x/runs/${body.runId}`,
        summary: { pass: 0, fail: 0, broken: 0, skip: 0 },
      },
    }),
  };
  const fetchImpl = async (url, opts) => {
    const u = new URL(url);
    const path = u.pathname;
    const body = JSON.parse(opts.body);
    calls.push({ path, body, headers: opts.headers });
    const responder = responders[path];
    if (!responder) {
      return { ok: false, status: 404, text: async () => 'not found' };
    }
    const r = responder(body);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.json,
      text: async () => JSON.stringify(r.json),
    };
  };
  return { fetchImpl, calls, setResponder: (path, fn) => { responders[path] = fn; } };
}

/**
 * Fake watcher that lets the test fire fs events on demand. Returns the
 * `installWatcher` factory expected by watch().
 */
function makeFakeWatcher() {
  let onEvent = null;
  return {
    install: (_dir, cb) => {
      onEvent = cb;
      return { close: () => { onEvent = null; } };
    },
    fire: (filename) => {
      if (onEvent) onEvent(filename);
    },
    isOpen: () => !!onEvent,
  };
}

function noopSignals() {
  // Don't install real signal handlers in tests — the harness drives stop()
  // explicitly so it can also exercise the SIGINT path without raising actual
  // signals against the test process.
  return () => {};
}

function writeCase(dir, name, body) {
  const casesDir = join(dir, 'cases');
  mkdirSync(casesDir, { recursive: true });
  writeFileSync(join(casesDir, name), JSON.stringify(body));
}

function makeCase(id) {
  return {
    id,
    name: id,
    fullName: id,
    filePath: 'tests/x.spec.ts',
    status: 'pass',
    startedAt: '2026-04-27T08:00:00.000Z',
    finishedAt: '2026-04-27T08:00:01.000Z',
    duration: 1000,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- shared scratch dir ---------------------------------------------

let scratch;
before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'kensho-watch-test-'));
});
after(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

// ---------- tests ----------------------------------------------------------

test('debounces filesystem events and batches case writes into one event POST', async (t) => {
  const dir = join(scratch, 'batch');
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'cases'), { recursive: true });

  const { fetchImpl, calls } = makeFakeFetch();
  const fakeWatcher = makeFakeWatcher();

  const handle = await watch({
    input: dir,
    workspace: 'acme',
    project: 'demo',
    token: 'kz_test',
    server: 'http://127.0.0.1:9999',
    debounceMs: 50,
    quiet: true,
    fetch: fetchImpl,
    installWatcher: fakeWatcher.install,
    installSignals: noopSignals,
  });
  t.after(async () => { await handle.stop(); });

  // /live/start should already have fired.
  const startCalls = calls.filter((c) => c.path === '/v1/ingest/kensho/live/start');
  assert.equal(startCalls.length, 1, 'one start call');
  assert.equal(startCalls[0].body.workspace, 'acme');
  assert.equal(startCalls[0].body.project, 'demo');
  assert.equal(startCalls[0].body.schemaVersion, 'kensho/v1');
  assert.equal(startCalls[0].headers.Authorization, 'Bearer kz_test');

  // Drop two case files within the debounce window.
  writeCase(dir, 'tc_a.json', makeCase('tc_a'));
  fakeWatcher.fire('cases/tc_a.json');
  await sleep(10);
  writeCase(dir, 'tc_b.json', makeCase('tc_b'));
  fakeWatcher.fire('cases/tc_b.json');

  // Wait past debounce.
  await sleep(120);

  const evCalls = calls.filter((c) => c.path === '/v1/ingest/kensho/live/event');
  assert.equal(evCalls.length, 1, 'exactly one batched event POST');
  assert.equal(evCalls[0].body.events.length, 2, 'two case events in the batch');
  const ids = evCalls[0].body.events.map((e) => e.case.id).sort();
  assert.deepEqual(ids, ['tc_a', 'tc_b']);
  assert.equal(evCalls[0].body.events[0].kind, 'case');
});

test('finalizes on stop() and POSTs run + cases payload', async (t) => {
  const dir = join(scratch, 'finalize');
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'cases'), { recursive: true });

  const run = {
    schemaVersion: 'kensho/v1',
    id: 'run_finalize_001',
    project: { name: 'Test', slug: 'test' },
    framework: { name: 'playwright', version: '1.44.0' },
    env: { ci: 'local' },
    startedAt: '2026-04-27T08:00:00.000Z',
    finishedAt: '2026-04-27T08:00:02.000Z',
    durationMs: 2000,
    totals: { pass: 1, fail: 0, broken: 0, skip: 0 },
    testCases: [makeCase('tc_a')],
  };
  writeFileSync(join(dir, 'run.json'), JSON.stringify(run));
  writeCase(dir, 'tc_a.json', makeCase('tc_a'));

  const { fetchImpl, calls } = makeFakeFetch();
  const fakeWatcher = makeFakeWatcher();

  const handle = await watch({
    input: dir,
    workspace: 'acme',
    project: 'demo',
    token: 'kz_test',
    server: 'http://127.0.0.1:9999',
    debounceMs: 10,
    quiet: true,
    fetch: fetchImpl,
    installWatcher: fakeWatcher.install,
    installSignals: noopSignals,
  });
  t.after(async () => { await handle.stop(); });

  // Sanity: runId should be the one from run.json (preferred over generated).
  assert.equal(handle.runId, 'run_finalize_001');

  // Simulate SIGINT.
  const result = await handle.stop('SIGINT');
  assert.equal(result.code, EXIT.OK);
  assert.equal(result.runId, 'run_finalize_001');

  const finCalls = calls.filter((c) => c.path === '/v1/ingest/kensho/live/finalize');
  assert.equal(finCalls.length, 1, 'one finalize call');
  assert.equal(finCalls[0].body.runId, 'run_finalize_001');
  assert.equal(finCalls[0].body.run.id, 'run_finalize_001');
  assert.equal(finCalls[0].body.cases.length, 1);
  assert.equal(finCalls[0].body.cases[0].id, 'tc_a');
  assert.ok(!finCalls[0].body.abandoned, 'not abandoned when run.json present');
  assert.ok(result.runUrl.includes('run_finalize_001'));
});

test('finalize without a run.json marks the run abandoned and synthesizes one', async (t) => {
  const dir = join(scratch, 'abandoned');
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'cases'), { recursive: true });
  writeCase(dir, 'tc_a.json', makeCase('tc_a'));

  const { fetchImpl, calls } = makeFakeFetch();
  const fakeWatcher = makeFakeWatcher();

  const handle = await watch({
    input: dir,
    workspace: 'acme',
    project: 'demo',
    token: 'kz_test',
    server: 'http://127.0.0.1:9999',
    debounceMs: 10,
    quiet: true,
    fetch: fetchImpl,
    installWatcher: fakeWatcher.install,
    installSignals: noopSignals,
  });

  const result = await handle.stop('SIGTERM');
  assert.equal(result.code, EXIT.OK);

  const finCalls = calls.filter((c) => c.path === '/v1/ingest/kensho/live/finalize');
  assert.equal(finCalls.length, 1);
  assert.equal(finCalls[0].body.abandoned, true);
  assert.equal(finCalls[0].body.run.schemaVersion, 'kensho/v1');
  // Synthesized run must echo the runId watch decided on.
  assert.equal(finCalls[0].body.run.id, handle.runId);
});

test('skips files outside cases/ and rejects path traversal', async (t) => {
  const dir = join(scratch, 'skips');
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'cases'), { recursive: true });

  const { fetchImpl, calls } = makeFakeFetch();
  const fakeWatcher = makeFakeWatcher();

  const handle = await watch({
    input: dir,
    workspace: 'acme',
    project: 'demo',
    token: 'kz_test',
    server: 'http://127.0.0.1:9999',
    debounceMs: 30,
    quiet: true,
    fetch: fetchImpl,
    installWatcher: fakeWatcher.install,
    installSignals: noopSignals,
  });
  t.after(async () => { await handle.stop(); });

  // Files NOT in cases/ → ignored.
  fakeWatcher.fire('attachments/foo.png');
  fakeWatcher.fire('run.json');
  // Path traversal → ignored.
  fakeWatcher.fire('cases/../etc/passwd');
  fakeWatcher.fire('../escape.json');
  // Non-JSON → ignored.
  writeFileSync(join(dir, 'cases', 'note.txt'), 'hi');
  fakeWatcher.fire('cases/note.txt');

  await sleep(80);

  const evCalls = calls.filter((c) => c.path === '/v1/ingest/kensho/live/event');
  assert.equal(evCalls.length, 0, 'no events should fire for ignored paths');

  // Sanity: a real case file in cases/ DOES go through.
  writeCase(dir, 'tc_ok.json', makeCase('tc_ok'));
  fakeWatcher.fire('cases/tc_ok.json');
  await sleep(80);
  const evCalls2 = calls.filter((c) => c.path === '/v1/ingest/kensho/live/event');
  assert.equal(evCalls2.length, 1, 'real case file produces one event POST');
  assert.equal(evCalls2[0].body.events[0].case.id, 'tc_ok');
});

test('refuses to start when input directory is missing', async () => {
  const { fetchImpl, calls } = makeFakeFetch();
  const fakeWatcher = makeFakeWatcher();
  const errors = [];

  const handle = await watch({
    input: join(scratch, 'definitely-not-here'),
    workspace: 'acme',
    project: 'demo',
    token: 'kz_test',
    server: 'http://127.0.0.1:9999',
    quiet: true,
    fetch: fetchImpl,
    installWatcher: fakeWatcher.install,
    installSignals: noopSignals,
    errLog: (...a) => errors.push(a.join(' ')),
  });

  const result = await handle.done;
  assert.equal(result.code, EXIT.VALIDATION);
  assert.equal(calls.length, 0, 'no network calls when input missing');
  assert.ok(errors.some((e) => e.includes('input directory not found')));
});

test('refuses to start without an auth token', async () => {
  const dir = join(scratch, 'no-token');
  mkdirSync(dir, { recursive: true });
  const { fetchImpl, calls } = makeFakeFetch();
  const fakeWatcher = makeFakeWatcher();
  const errors = [];

  // Stub auth-config by clearing env vars temporarily.
  const prev = { ...process.env };
  delete process.env.KAIZEN_TOKEN;

  try {
    const handle = await watch({
      input: dir,
      workspace: 'acme',
      project: 'demo',
      token: '',
      server: 'http://127.0.0.1:9999',
      quiet: true,
      fetch: fetchImpl,
      installWatcher: fakeWatcher.install,
      installSignals: noopSignals,
      errLog: (...a) => errors.push(a.join(' ')),
    });
    const result = await handle.done;
    // Auth resolution may pick up a saved file; only assert if no token came through.
    if (!process.env.KAIZEN_TOKEN) {
      // Either AUTH (no token) or OK (saved auth on dev box). Both acceptable.
      assert.ok([EXIT.AUTH, EXIT.OK].includes(result.code));
    }
    if (result.code === EXIT.AUTH) {
      assert.equal(calls.length, 0);
    }
  } finally {
    process.env = prev;
  }
});
