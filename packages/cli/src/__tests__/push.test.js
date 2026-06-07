// Tests for `kensho push`. We use node:test (built-in, no extra dep) and
// stand up a tiny mock ingest server on a random port for each scenario.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { push, EXIT } from '../push.js';

// ---------- mock ingest server ---------------------------------------------

function startMock({ initHandler, putHandler, finalizeHandler } = {}) {
  const calls = { init: [], puts: [], finalize: [] };
  // S3 is on the same loopback as the API for test convenience: the server
  // hands out URLs that point back to itself under /s3/<id>.
  let basePort;

  const server = createServer(async (req, res) => {
    const url = req.url || '/';
    const auth = req.headers.authorization || '';

    const readBody = () => new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });

    if (req.method === 'POST' && url === '/v1/ingest/kensho/init') {
      const body = JSON.parse((await readBody()).toString('utf8'));
      calls.init.push({ body, auth });
      const response = initHandler
        ? initHandler(body, basePort)
        : defaultInit(body, basePort);
      res.writeHead(response.status || 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response.body));
      return;
    }

    if (req.method === 'PUT' && url.startsWith('/s3/')) {
      const id = decodeURIComponent(url.slice('/s3/'.length));
      const body = await readBody();
      calls.puts.push({ id, size: body.length, contentType: req.headers['content-type'] });
      const response = putHandler ? putHandler(id, body) : { status: 200 };
      res.writeHead(response.status, response.headers || {});
      res.end(response.bodyText || '');
      return;
    }

    if (req.method === 'POST' && url === '/v1/ingest/kensho/finalize') {
      const body = JSON.parse((await readBody()).toString('utf8'));
      calls.finalize.push({ body, auth });
      const response = finalizeHandler
        ? finalizeHandler(body)
        : defaultFinalize(body);
      res.writeHead(response.status || 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response.body));
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      basePort = addr.port;
      resolve({ server, port: basePort, base: `http://127.0.0.1:${basePort}`, calls });
    });
  });
}

function defaultInit(body, port) {
  return {
    status: 200,
    body: {
      uploadId: 'up_test_001',
      presignedUrls: (body.attachments || []).map((a) => ({
        id: a.id,
        url: `http://127.0.0.1:${port}/s3/${encodeURIComponent(a.id)}`,
        headers: {},
      })),
      deduplicated: [],
    },
  };
}

function defaultFinalize(body) {
  const totals = body?.run?.totals || { pass: 0, fail: 0, broken: 0, skip: 0 };
  return {
    status: 200,
    body: {
      runUrl: `https://app.kaizenreport.com/${body?.run?.project?.slug || 'x'}/runs/${body?.run?.id}`,
      internalRunId: 'irun_' + (body?.run?.id || 'x'),
      summary: {
        pass: totals.pass,
        fail: totals.fail,
        broken: totals.broken,
        skip: totals.skip,
        total: totals.pass + totals.fail + totals.broken + totals.skip,
        regressions: 0,
        recoveries: 0,
        flakeAlerts: [],
      },
    },
  };
}

// ---------- fixture builders ------------------------------------------------

function makeValidRun() {
  return {
    schemaVersion: 'kensho/v1',
    id: 'run_test_001',
    project: { name: 'Test', slug: 'test' },
    framework: { name: 'playwright', version: '1.44.0' },
    env: { ci: 'local' },
    startedAt: '2026-04-27T08:00:00.000Z',
    finishedAt: '2026-04-27T08:00:01.000Z',
    durationMs: 1000,
    totals: { pass: 1, fail: 0, broken: 0, skip: 0 },
    testCases: [
      {
        id: 'tc_aaa',
        name: 'sample',
        fullName: 'sample fullname',
        filePath: 'tests/sample.spec.ts',
        status: 'pass',
        startedAt: '2026-04-27T08:00:00.000Z',
        finishedAt: '2026-04-27T08:00:01.000Z',
        duration: 1000,
        attachments: [],
      },
    ],
  };
}

function writeResults(dir, { run, cases = [], attachments = {} }) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'run.json'), JSON.stringify(run, null, 2));
  if (cases.length) {
    const casesDir = join(dir, 'cases');
    mkdirSync(casesDir, { recursive: true });
    for (const c of cases) {
      writeFileSync(join(casesDir, `${c.id}.json`), JSON.stringify(c, null, 2));
    }
  }
  for (const [relPath, contents] of Object.entries(attachments)) {
    const full = join(dir, relPath);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
}

// ---------- shared scratch dir ---------------------------------------------

let scratch;
let mockState; // { server, base, calls } per-test

before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'kensho-push-test-'));
});

after(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

beforeEach(() => {
  // Reset mock-state holder; individual tests call startMock() themselves so
  // the harness can vary handlers per test.
  mockState = null;
});

async function teardownMock() {
  if (mockState?.server) {
    await new Promise((r) => mockState.server.close(r));
    mockState = null;
  }
}

// ---------- tests -----------------------------------------------------------

test('valid run uploads correctly with mocked endpoints', async (t) => {
  mockState = await startMock();
  t.after(teardownMock);

  const dir = join(scratch, 'valid-run');
  const run = makeValidRun();
  const cases = [{
    ...run.testCases[0],
    attachments: [
      { id: 'att-1', kind: 'log', relativePath: 'attachments/tc_aaa/log.txt', mimeType: 'text/plain' },
    ],
  }];
  // run.testCases needs to mirror cases for validation to see attachments.
  run.testCases = [cases[0]];
  writeResults(dir, {
    run,
    cases,
    attachments: { 'attachments/tc_aaa/log.txt': 'hello world\n' },
  });

  const result = await push({
    input: dir,
    workspace: 'acme',
    project: 'demo',
    token: 'kz_test_abc',
    server: mockState.base,
    quiet: true,
  });

  assert.equal(result.code, EXIT.OK, 'exit code should be 0');
  assert.equal(mockState.calls.init.length, 1);
  assert.equal(mockState.calls.init[0].body.workspace, 'acme');
  assert.equal(mockState.calls.init[0].body.project, 'demo');
  assert.equal(mockState.calls.init[0].body.runId, 'run_test_001');
  assert.equal(mockState.calls.init[0].body.schemaVersion, 'kensho/v1');
  assert.equal(mockState.calls.init[0].body.attachments.length, 1);
  assert.equal(mockState.calls.init[0].auth, 'Bearer kz_test_abc');

  assert.equal(mockState.calls.puts.length, 1, 'one attachment uploaded');
  assert.equal(mockState.calls.puts[0].size, 'hello world\n'.length);

  assert.equal(mockState.calls.finalize.length, 1);
  assert.equal(mockState.calls.finalize[0].body.uploadId, 'up_test_001');
  assert.equal(mockState.calls.finalize[0].body.run.id, 'run_test_001');
  assert.equal(mockState.calls.finalize[0].body.cases.length, 1);
  assert.ok(result.runUrl.includes('run_test_001'));
});

test('invalid run refuses to upload without --force', async (t) => {
  mockState = await startMock();
  t.after(teardownMock);

  const dir = join(scratch, 'invalid-run');
  const run = makeValidRun();
  delete run.id; // missing required field
  // run.totals is required and must be present, but `id` is also required.
  writeResults(dir, { run });

  const result = await push({
    input: dir,
    workspace: 'acme',
    project: 'demo',
    token: 'kz_test_abc',
    server: mockState.base,
    quiet: true,
  });

  assert.equal(result.code, EXIT.VALIDATION);
  assert.equal(mockState.calls.init.length, 0, 'no init request should fire');
  assert.equal(mockState.calls.finalize.length, 0);
  assert.ok(Array.isArray(result.errors) && result.errors.length > 0);
});

test('idempotent re-push returns the same run URL', async (t) => {
  // Behavior: server returns same internalRunId + runUrl on a duplicate
  // (workspace, project, runId). Our CLI just prints what the server returned.
  const seen = new Map();
  mockState = await startMock({
    finalizeHandler: (body) => {
      const key = `${body.run.project.slug}|${body.run.id}`;
      const existing = seen.get(key);
      if (existing) {
        return { status: 200, body: existing };
      }
      const fresh = defaultFinalize(body).body;
      seen.set(key, fresh);
      return { status: 200, body: fresh };
    },
  });
  t.after(teardownMock);

  const dir = join(scratch, 'idempotent-run');
  const run = makeValidRun();
  writeResults(dir, { run });

  const first = await push({
    input: dir, workspace: 'acme', project: 'demo',
    token: 'kz_test_abc', server: mockState.base, quiet: true,
  });
  const second = await push({
    input: dir, workspace: 'acme', project: 'demo',
    token: 'kz_test_abc', server: mockState.base, quiet: true,
  });

  assert.equal(first.code, EXIT.OK);
  assert.equal(second.code, EXIT.OK);
  assert.equal(first.internalRunId, second.internalRunId);
  assert.equal(first.runUrl, second.runUrl);
  assert.equal(mockState.calls.init.length, 2);
  assert.equal(mockState.calls.finalize.length, 2);
});

test('--dry-run validates and prints but never POSTs', async (t) => {
  mockState = await startMock();
  t.after(teardownMock);

  const dir = join(scratch, 'dry-run');
  const run = makeValidRun();
  const cases = [{
    ...run.testCases[0],
    attachments: [
      { id: 'att-1', kind: 'log', relativePath: 'attachments/tc_aaa/log.txt', mimeType: 'text/plain' },
    ],
  }];
  run.testCases = [cases[0]];
  writeResults(dir, {
    run, cases,
    attachments: { 'attachments/tc_aaa/log.txt': 'hi\n' },
  });

  const logs = [];
  const result = await push({
    input: dir,
    workspace: 'acme',
    project: 'demo',
    token: 'kz_test_abc',
    server: mockState.base,
    dryRun: true,
    log: (...a) => logs.push(a.join(' ')),
  });

  assert.equal(result.code, EXIT.OK);
  assert.equal(result.dryRun, true);
  assert.equal(mockState.calls.init.length, 0);
  assert.equal(mockState.calls.puts.length, 0);
  assert.equal(mockState.calls.finalize.length, 0);
  // The log should mention the workspace + attachments count.
  assert.ok(logs.some((l) => l.includes('dry run')));
  assert.ok(logs.some((l) => l.includes('attachments: 1')));
});
