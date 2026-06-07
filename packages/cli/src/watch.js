// kensho watch — drive a *live run*: stream case files to the Kaizen platform
// as a test process writes them so users see the run paint in real time.
//
// Flow:
//   1. Resolve config (flags > kensho.config.json > ~/.config/kensho/auth.json
//      > KAIZEN_* env vars) — same layering as `push.js`.
//   2. POST <server>/v1/ingest/kensho/live/start with
//      { workspace, project, runId, schemaVersion }. The server returns
//      { runId, channel? }.
//   3. Watch <input>/cases/ for new/changed *.json files using node:fs.watch
//      (recursive). Debounce filesystem events; on each tick, read all files
//      that have changed since the last batch and POST a batched
//      /v1/ingest/kensho/live/event { runId, events: [{ kind:'case', case }] }.
//   4. On Ctrl-C / SIGINT / SIGTERM (and `finalizeOnExit`), POST
//      /v1/ingest/kensho/live/finalize with the final run.json + cases. If
//      run.json never landed, synthesize a minimal one and mark it abandoned.
//
// Attachments are NOT uploaded in live mode — the existing /init + presigned
// PUT path handles those at final batch finalize. Users who need attachments
// in the live UI should run `kensho push` after the test process finishes.
//
// Exit codes:
//   0  clean shutdown (finalize succeeded)
//   1  input dir missing / unreadable, or finalize failed validation
//   2  auth failure
//   3  network failure (start / event / finalize)

import { readFileSync, readdirSync, existsSync, statSync, watch as fsWatch } from 'node:fs';
import { join, relative, resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateRun, computeTotals, SCHEMA_VERSION } from '@kaizenreport/kensho-schema';
import { loadAuth } from './auth-config.js';

const DEFAULT_SERVER = 'https://api.kaizenreport.com';
const DEFAULT_DEBOUNCE_MS = 200;
const RETRY_DELAY_MS = 250;

export const EXIT = {
  OK: 0,
  VALIDATION: 1,
  AUTH: 2,
  NETWORK: 3,
};

/**
 * Run a watcher. Returns a handle with `.stop()` (graceful finalize) and
 * `.done` (Promise that resolves with the final exit-code-style result).
 *
 * @param {object} opts
 * @param {string} opts.input        Path to kensho-results/.
 * @param {string} [opts.workspace]
 * @param {string} [opts.project]
 * @param {string} [opts.token]
 * @param {string} [opts.server]
 * @param {number} [opts.debounceMs] Default 200.
 * @param {boolean} [opts.finalizeOnExit]  Default true.
 * @param {boolean} [opts.quiet]
 * @param {typeof fetch} [opts.fetch]
 * @param {(...a: any[]) => void} [opts.log]
 * @param {(...a: any[]) => void} [opts.errLog]
 * @param {(handler: () => void) => () => void} [opts.installSignals]
 *        Test seam: install SIGINT/SIGTERM handlers, return uninstaller.
 * @param {(dir: string, onEvent: (filename: string) => void) => { close: () => void }} [opts.installWatcher]
 *        Test seam: stub the fs watcher.
 *
 * @returns {Promise<{ stop: (sig?: string) => Promise<{ code: number, errors?: string[], runId?: string, runUrl?: string }>, done: Promise<{ code: number, errors?: string[], runId?: string, runUrl?: string }>, sendBatchNow: () => Promise<void>, runId: string }>}
 */
export async function watch(opts) {
  const log = opts.log || ((...a) => { if (!opts.quiet) console.log(...a); });
  const errLog = opts.errLog || ((...a) => console.error(...a));
  const fetchImpl = opts.fetch || globalThis.fetch;
  const debounceMs = Number.isFinite(opts.debounceMs) ? Math.max(0, opts.debounceMs) : DEFAULT_DEBOUNCE_MS;
  const finalizeOnExit = opts.finalizeOnExit !== false;

  // ---- 1. resolve config -------------------------------------------------
  const cfg = resolveConfig(opts);
  if (!cfg.input || !existsSync(cfg.input)) {
    errLog(`[kensho:watch] input directory not found: ${cfg.input}`);
    const result = { code: EXIT.VALIDATION, errors: ['input directory not found'] };
    return makeFailedHandle(result);
  }

  const workspace = cfg.workspace;
  const project = cfg.project;
  if (!workspace) {
    errLog('[kensho:watch] no workspace specified (use --workspace, kensho.config.json, or KAIZEN_WORKSPACE)');
    return makeFailedHandle({ code: EXIT.AUTH, errors: ['workspace required'] });
  }
  if (!project) {
    errLog('[kensho:watch] no project specified (use --project, kensho.config.json, or KAIZEN_PROJECT)');
    return makeFailedHandle({ code: EXIT.VALIDATION, errors: ['project required'] });
  }
  if (!cfg.token) {
    errLog('[kensho:watch] no auth token; run `kensho login` or set KAIZEN_TOKEN');
    return makeFailedHandle({ code: EXIT.AUTH, errors: ['token required'] });
  }
  const server = (cfg.server || DEFAULT_SERVER).replace(/\/+$/, '');

  // ---- 2. determine runId ------------------------------------------------
  // Prefer the runId in run.json if it already exists; otherwise generate one.
  const runJsonPath = join(cfg.input, 'run.json');
  let runId;
  if (existsSync(runJsonPath)) {
    try {
      runId = JSON.parse(readFileSync(runJsonPath, 'utf8'))?.id;
    } catch { /* ignore — will fall back below */ }
  }
  if (!runId) runId = `run_${randomUUID()}`;

  const startedAt = new Date().toISOString();

  // ---- 3. POST /live/start -----------------------------------------------
  log('[kensho:watch] ▶ starting…');
  let startRes;
  try {
    startRes = await postJson(fetchImpl, `${server}/v1/ingest/kensho/live/start`, cfg.token, {
      workspace,
      project,
      runId,
      schemaVersion: SCHEMA_VERSION,
    });
  } catch (err) {
    errLog(`[kensho:watch] start failed: ${err.message}`);
    return makeFailedHandle(classifyHttpError(err));
  }

  // The server may rewrite runId; respect what it returned.
  runId = startRes?.runId || runId;
  log(`[kensho:watch] · live channel open (runId=${runId})`);

  // ---- 4. set up the watcher --------------------------------------------
  const casesDir = join(cfg.input, 'cases');
  // Track file → mtime so we re-read only what changed since the last batch.
  const sentMtimes = new Map();
  const dirty = new Set();
  let pending = null; // setTimeout handle
  let stopping = false;
  let stoppedResolved = false;
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  let lastResult = null;

  const flushBatch = async () => {
    pending = null;
    if (!dirty.size) return;
    const batch = Array.from(dirty);
    dirty.clear();
    const events = [];
    for (const filename of batch) {
      // Path traversal guard — only accept basenames inside cases/.
      if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        continue;
      }
      if (!filename.endsWith('.json')) continue;
      const full = join(casesDir, filename);
      if (!existsSync(full)) continue;
      let st;
      try { st = statSync(full); } catch { continue; }
      if (!st.isFile()) continue;
      const mtime = st.mtimeMs;
      const prev = sentMtimes.get(filename);
      if (prev != null && prev >= mtime) continue;
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(full, 'utf8'));
      } catch (err) {
        errLog(`[kensho:watch] skipping cases/${filename}: ${err.message}`);
        continue;
      }
      sentMtimes.set(filename, mtime);
      events.push({ kind: 'case', case: parsed });
    }
    if (!events.length) return;
    try {
      await postJson(fetchImpl, `${server}/v1/ingest/kensho/live/event`, cfg.token, {
        runId,
        events,
      });
      log(`[kensho:watch] · sent ${events.length} event${events.length === 1 ? '' : 's'}`);
    } catch (err) {
      // Non-fatal — log and keep going. The final finalize will replay state.
      errLog(`[kensho:watch] event POST failed: ${err.message}`);
    }
  };

  const scheduleFlush = () => {
    if (stopping) return;
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => { flushBatch().catch(() => {}); }, debounceMs);
  };

  const onWatcherEvent = (filename) => {
    if (!filename) return;
    // The recursive watcher emits paths like "cases/foo.json" on darwin and
    // sometimes just "foo.json" depending on which dir was being watched.
    // Strip everything before the last separator and only react to entries
    // whose parent is `cases/`.
    const norm = String(filename).replace(/\\/g, '/');
    let bn = norm;
    let parent = '';
    const slash = norm.lastIndexOf('/');
    if (slash >= 0) {
      bn = norm.slice(slash + 1);
      parent = norm.slice(0, slash);
    }
    // If the watcher fed us a path that includes a parent, that parent must
    // resolve to "cases" (i.e. we're watching the input dir, not cases/).
    if (parent && !parent.split('/').filter(Boolean).includes('cases')) return;
    if (!bn.endsWith('.json')) return;
    if (bn.includes('..')) return;
    dirty.add(bn);
    scheduleFlush();
  };

  // Pick up any *.json files that were already on disk before the watcher started.
  if (existsSync(casesDir)) {
    try {
      for (const f of readdirSync(casesDir)) {
        if (f.endsWith('.json')) {
          dirty.add(f);
        }
      }
      if (dirty.size) scheduleFlush();
    } catch { /* ignore */ }
  }

  // Install the watcher. Default impl uses node:fs.watch recursively on the
  // input dir so we catch the moment cases/ is created mid-run.
  let watcherHandle;
  try {
    if (opts.installWatcher) {
      watcherHandle = opts.installWatcher(cfg.input, onWatcherEvent);
    } else {
      const w = fsWatch(cfg.input, { recursive: true }, (_event, filename) => {
        onWatcherEvent(filename);
      });
      w.on?.('error', (err) => {
        errLog(`[kensho:watch] watcher error: ${err.message}`);
      });
      watcherHandle = { close: () => { try { w.close(); } catch { /* ignore */ } } };
    }
  } catch (err) {
    errLog(`[kensho:watch] failed to install watcher: ${err.message}`);
    return makeFailedHandle({ code: EXIT.VALIDATION, errors: [err.message] });
  }

  // ---- 5. final shutdown -------------------------------------------------
  const stop = async (sig) => {
    if (stopping) return done;
    stopping = true;
    if (pending) { clearTimeout(pending); pending = null; }
    // Flush whatever's still queued so the finalize payload is comprehensive.
    try { await flushBatch(); } catch { /* ignore */ }
    try { watcherHandle?.close?.(); } catch { /* ignore */ }
    if (sig) log(`[kensho:watch] · received ${sig} — finalizing…`);

    let result;
    if (finalizeOnExit) {
      result = await finalize({
        fetchImpl, server, token: cfg.token, runId,
        inputDir: cfg.input, startedAt, log, errLog, sentMtimes,
      });
    } else {
      result = { code: EXIT.OK, runId };
    }
    lastResult = result;
    if (!stoppedResolved) {
      stoppedResolved = true;
      resolveDone(result);
    }
    return result;
  };

  // Install signal handlers (test-overridable).
  let uninstallSignals = () => {};
  if (opts.installSignals) {
    uninstallSignals = opts.installSignals(() => { stop('signal').catch(() => {}); });
  } else {
    const onSig = (sig) => { stop(sig).catch(() => {}); };
    const sigInt = () => onSig('SIGINT');
    const sigTerm = () => onSig('SIGTERM');
    process.on('SIGINT', sigInt);
    process.on('SIGTERM', sigTerm);
    uninstallSignals = () => {
      process.off('SIGINT', sigInt);
      process.off('SIGTERM', sigTerm);
    };
  }

  // After done resolves, uninstall signals so process can exit cleanly.
  done.then(() => { try { uninstallSignals(); } catch {} });

  return {
    runId,
    stop,
    done,
    sendBatchNow: flushBatch,
  };
}

/** CLI wrapper — translates a watch session into an exit code. */
export async function watchCli(opts) {
  const handle = await watch(opts);
  const result = await handle.done;
  return result?.code ?? EXIT.OK;
}

// ---------- finalize -------------------------------------------------------

async function finalize({ fetchImpl, server, token, runId, inputDir, startedAt, log, errLog, sentMtimes }) {
  // Re-read run.json + every case file from disk so the finalize body is the
  // user's authoritative final state.
  const runPath = join(inputDir, 'run.json');
  const casesDir = join(inputDir, 'cases');
  let run = null;
  let abandoned = false;

  if (existsSync(runPath)) {
    try {
      run = JSON.parse(readFileSync(runPath, 'utf8'));
    } catch (err) {
      errLog(`[kensho:watch] failed to parse run.json on finalize: ${err.message}`);
    }
  }

  const cases = [];
  if (existsSync(casesDir)) {
    try {
      for (const f of readdirSync(casesDir)) {
        if (!f.endsWith('.json')) continue;
        if (f.includes('..') || f.includes('/') || f.includes('\\')) continue;
        try {
          const c = JSON.parse(readFileSync(join(casesDir, f), 'utf8'));
          cases.push(c);
        } catch (err) {
          errLog(`[kensho:watch] skipping cases/${f}: ${err.message}`);
        }
      }
    } catch { /* ignore */ }
  }

  if (!run) {
    abandoned = true;
    run = {
      schemaVersion: SCHEMA_VERSION,
      id: runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      totals: computeTotals(cases),
      env: {},
    };
  } else {
    // Recompute totals from disk so the manifest matches what we send.
    run.totals = computeTotals(cases.length ? cases : (run.testCases || []));
    if (!run.id) run.id = runId;
  }

  // If we have a real run, lightly validate; on failure don't block the
  // finalize, just warn.
  if (!abandoned) {
    const v = validateRun({ ...run, testCases: cases.length ? cases : (run.testCases || []) });
    if (!v.ok) {
      errLog(`[kensho:watch] ! ${v.errors.length} validation warning(s) on final run — sending anyway`);
    }
  }

  let finRes;
  try {
    finRes = await postJson(fetchImpl, `${server}/v1/ingest/kensho/live/finalize`, token, {
      runId,
      run,
      cases,
      abandoned: abandoned || undefined,
    });
  } catch (err) {
    errLog(`[kensho:watch] finalize failed: ${err.message}`);
    return classifyHttpError(err, runId);
  }

  if (finRes?.runUrl) {
    log(`[kensho:watch] ✓ run finalized · ${finRes.runUrl}`);
  } else {
    log('[kensho:watch] ✓ run finalized');
  }
  return { code: EXIT.OK, runId, runUrl: finRes?.runUrl, summary: finRes?.summary };
}

// ---------- helpers --------------------------------------------------------

function resolveConfig(opts) {
  const fileCfg = loadConfigFile(opts.input);
  const persisted = loadAuth() || {};
  const env = process.env;
  return {
    input: resolveInputDir(opts.input),
    workspace: opts.workspace || fileCfg.workspace || env.KAIZEN_WORKSPACE || persisted.workspace || '',
    project: opts.project || fileCfg.project || env.KAIZEN_PROJECT || '',
    token: opts.token || env.KAIZEN_TOKEN || persisted.token || '',
    server: opts.server || fileCfg.server || env.KAIZEN_SERVER || persisted.server || DEFAULT_SERVER,
  };
}

function resolveInputDir(input) {
  if (!input) return resolve(process.cwd(), 'kensho-results');
  return resolve(process.cwd(), input);
}

function loadConfigFile(input) {
  try {
    const dir = input ? resolve(process.cwd(), input) : resolve(process.cwd(), 'kensho-results');
    const candidate = join(dir, '..', 'kensho.config.json');
    if (existsSync(candidate)) {
      const raw = JSON.parse(readFileSync(candidate, 'utf8'));
      return raw?.kaizen || raw || {};
    }
  } catch { /* ignore */ }
  return {};
}

async function postJson(fetchImpl, url, token, body) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await safeText(res);
    const err = new Error(`${url} → ${res.status} ${detail}`);
    err.status = res.status;
    throw err;
  }
  return await res.json();
}

async function safeText(res) {
  try { return (await res.text()).slice(0, 400); } catch { return ''; }
}

function classifyHttpError(err, runId) {
  const status = err?.status || 0;
  if (status === 401 || status === 403) return { code: EXIT.AUTH, errors: [err.message], runId };
  return { code: EXIT.NETWORK, errors: [err.message], runId };
}

function makeFailedHandle(result) {
  return {
    runId: result.runId,
    stop: async () => result,
    done: Promise.resolve(result),
    sendBatchNow: async () => {},
  };
}
