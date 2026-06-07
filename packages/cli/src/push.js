// kensho push — upload a kensho-results/ directory to the Kaizen platform.
//
// Flow:
//   1. Resolve config (flags > kensho.config.json > ~/.config/kensho/auth.json
//      > KAIZEN_* env vars).
//   2. Read run.json + cases/*.json + walk attachments/.
//   3. Validate locally with `validateRun`. Refuse to upload an invalid run
//      unless --force.
//   4. POST <server>/v1/ingest/kensho/init with the attachment manifest.
//   5. PUT each non-deduplicated attachment to its presigned URL (parallel:8,
//      retry once on 5xx).
//   6. POST <server>/v1/ingest/kensho/finalize with the run + cases JSON.
//   7. Print run URL + summary line.
//
// Exit codes (used by `pushCli`):
//   0  success
//   1  schema-validation failure (or generic local error)
//   2  auth failure
//   3  upload failure (init/PUT/finalize all funnel into here)
//   With --strict, exit code = summary.regressions on success.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, resolve, sep, posix, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { validateRun, computeTotals, SCHEMA_VERSION } from '@kaizenreport/kensho-schema';
import { loadAuth } from './auth-config.js';

const DEFAULT_SERVER = 'https://api.kaizenreport.com';
const PARALLELISM = 8;
const RETRY_DELAY_MS = 250;

// ---------- exit-code sentinels (also used by tests) -----------------------
export const EXIT = {
  OK: 0,
  VALIDATION: 1,
  AUTH: 2,
  UPLOAD: 3,
};

// ---------- public API -----------------------------------------------------

/**
 * Run a push. Returns a structured result; no `process.exit` calls so tests
 * can drive it directly.
 *
 * @param {object} opts
 * @param {string} opts.input        Path to kensho-results/.
 * @param {string} [opts.workspace]
 * @param {string} [opts.project]
 * @param {string} [opts.token]
 * @param {string} [opts.server]
 * @param {string[]} [opts.labels]    Repeatable `--label k=v` values.
 * @param {boolean} [opts.dryRun]
 * @param {boolean} [opts.noAttachments]
 * @param {boolean} [opts.quiet]
 * @param {boolean} [opts.force]
 * @param {boolean} [opts.strict]
 * @param {typeof fetch} [opts.fetch] Override fetch (tests).
 * @param {(...a: any[]) => void} [opts.log]   Override logger (tests).
 *
 * @returns {Promise<{ code: number, runUrl?: string, summary?: object, internalRunId?: string, errors?: string[] }>}
 */
export async function push(opts) {
  const log = opts.log || ((...a) => { if (!opts.quiet) console.log(...a); });
  const errLog = (...a) => console.error(...a);
  const fetchImpl = opts.fetch || globalThis.fetch;
  const labels = opts.labels || [];

  // ---- 1. resolve config from layered sources ----------------------------
  const cfg = resolveConfig(opts);
  if (!cfg.input || !existsSync(cfg.input)) {
    errLog(`[kensho] input directory not found: ${cfg.input}`);
    return { code: EXIT.VALIDATION, errors: ['input directory not found'] };
  }

  // ---- 2. load run + cases ------------------------------------------------
  const runPath = join(cfg.input, 'run.json');
  if (!existsSync(runPath)) {
    errLog(`[kensho] missing run.json in ${relative(process.cwd(), cfg.input)}`);
    return { code: EXIT.VALIDATION, errors: ['missing run.json'] };
  }
  let run;
  try {
    run = JSON.parse(readFileSync(runPath, 'utf8'));
  } catch (err) {
    errLog(`[kensho] failed to parse run.json: ${err.message}`);
    return { code: EXIT.VALIDATION, errors: [err.message] };
  }

  const cases = [];
  const casesDir = join(cfg.input, 'cases');
  if (existsSync(casesDir)) {
    const byId = new Map(run.testCases.map((c) => [c.id, c]));
    for (const f of readdirSync(casesDir).filter((n) => n.endsWith('.json'))) {
      try {
        const c = JSON.parse(readFileSync(join(casesDir, f), 'utf8'));
        byId.set(c.id, c);
      } catch (err) {
        errLog(`[kensho] cases/${f}: ${err.message}`);
        return { code: EXIT.VALIDATION, errors: [`cases/${f}: ${err.message}`] };
      }
    }
    cases.push(...byId.values());
    run.testCases = cases.slice();
  } else {
    cases.push(...(run.testCases || []));
  }
  run.totals = computeTotals(run.testCases);

  // Merge --label k=v pairs into run.env.vars (preserves what's already there).
  if (labels.length) {
    run.env = run.env || {};
    run.env.vars = { ...(run.env.vars || {}) };
    for (const kv of labels) {
      const eq = kv.indexOf('=');
      if (eq < 1) {
        errLog(`[kensho] ignoring malformed --label "${kv}" (expected k=v)`);
        continue;
      }
      run.env.vars[kv.slice(0, eq)] = kv.slice(eq + 1);
    }
  }

  // ---- 3. validate locally -----------------------------------------------
  const validation = validateRun(run);
  if (!validation.ok) {
    if (!opts.force) {
      errLog(`[kensho] ✗ ${validation.errors.length} schema validation error(s):`);
      for (const e of validation.errors.slice(0, 20)) errLog('  -', e);
      if (validation.errors.length > 20) errLog(`  … and ${validation.errors.length - 20} more`);
      errLog('[kensho] refusing to upload an invalid run; pass --force to override.');
      return { code: EXIT.VALIDATION, errors: validation.errors };
    }
    errLog(`[kensho] ! ${validation.errors.length} validation error(s) — uploading anyway because --force`);
  } else {
    log(`[kensho] validating ${relative(process.cwd(), cfg.input)} … ${run.testCases.length} cases, schema OK`);
  }

  // ---- 4. resolve workspace / project / token ----------------------------
  const workspace = cfg.workspace;
  const project = cfg.project || run?.project?.slug;
  if (!workspace) {
    errLog('[kensho] no workspace specified (use --workspace, kensho.config.json, or KAIZEN_WORKSPACE)');
    return { code: EXIT.AUTH, errors: ['workspace required'] };
  }
  if (!project) {
    errLog('[kensho] no project specified (use --project, kensho.config.json, or run.project.slug)');
    return { code: EXIT.VALIDATION, errors: ['project required'] };
  }
  if (!opts.dryRun && !cfg.token) {
    errLog('[kensho] no auth token; run `kensho login` or set KAIZEN_TOKEN');
    return { code: EXIT.AUTH, errors: ['token required'] };
  }
  const server = (cfg.server || DEFAULT_SERVER).replace(/\/+$/, '');

  // ---- 5. build attachment manifest --------------------------------------
  const skipAttachments = !!opts.noAttachments;
  const manifest = skipAttachments ? [] : buildAttachmentManifest(cfg.input, cases);

  // ---- 6. dry-run short-circuit ------------------------------------------
  if (opts.dryRun) {
    log(`[kensho] dry run — would upload to ${server}`);
    log(`[kensho]   workspace: ${workspace}`);
    log(`[kensho]   project:   ${project}`);
    log(`[kensho]   runId:     ${run.id}`);
    log(`[kensho]   cases:     ${run.testCases.length}`);
    log(`[kensho]   attachments: ${manifest.length}` + (skipAttachments ? ' (skipped via --no-attachments)' : ''));
    if (manifest.length) {
      const total = manifest.reduce((a, m) => a + m.sizeBytes, 0);
      log(`[kensho]   total bytes: ${total}`);
    }
    return { code: EXIT.OK, dryRun: true, summary: { manifest, run, cases } };
  }

  // ---- 7. POST /v1/ingest/kensho/init ------------------------------------
  let initRes;
  try {
    initRes = await postJson(fetchImpl, `${server}/v1/ingest/kensho/init`, cfg.token, {
      workspace,
      project,
      runId: run.id,
      schemaVersion: SCHEMA_VERSION,
      attachments: manifest,
    });
  } catch (err) {
    errLog(`[kensho] init failed: ${err.message}`);
    return classifyHttpError(err);
  }

  const presigned = new Map((initRes.presignedUrls || []).map((p) => [p.id, p]));
  const dedup = new Set((initRes.deduplicated || []).map((d) => d.id));
  const toUpload = manifest.filter((m) => !dedup.has(m.id) && presigned.has(m.id));

  // ---- 8. PUT attachments ------------------------------------------------
  if (toUpload.length) {
    const startedAt = Date.now();
    const totalBytes = toUpload.reduce((a, m) => a + m.sizeBytes, 0);
    try {
      await uploadAll(fetchImpl, toUpload, presigned);
    } catch (err) {
      errLog(`[kensho] attachment upload failed: ${err.message}`);
      return { code: EXIT.UPLOAD, errors: [err.message] };
    }
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    log(`[kensho] uploading attachments … ${toUpload.length} files · ${formatBytes(totalBytes)} · ${elapsed}s`);
  } else if (manifest.length) {
    log(`[kensho] all ${manifest.length} attachment(s) already uploaded (deduplicated)`);
  }

  // ---- 9. POST /v1/ingest/kensho/finalize --------------------------------
  let finRes;
  try {
    log('[kensho] finalizing run …');
    finRes = await postJson(fetchImpl, `${server}/v1/ingest/kensho/finalize`, cfg.token, {
      uploadId: initRes.uploadId,
      run,
      cases,
    });
  } catch (err) {
    errLog(`[kensho] finalize failed: ${err.message}`);
    return classifyHttpError(err);
  }

  const summary = finRes.summary || {};
  log('[kensho] ✓ run uploaded');
  if (finRes.runUrl) log('   ' + finRes.runUrl);
  log('   ' + formatTotalsLine(summary, run.totals));
  if (Number.isFinite(summary.regressions) || Number.isFinite(summary.recoveries)) {
    const reg = summary.regressions ?? 0;
    const rec = summary.recoveries ?? 0;
    if (reg || rec) {
      log(`   ${reg} newly failing · ${rec} newly passing`);
    }
  }

  const code = opts.strict ? (summary.regressions || 0) : EXIT.OK;
  return { code, runUrl: finRes.runUrl, summary, internalRunId: finRes.internalRunId };
}

/** Top-level CLI entry that translates a push() result into a process exit code. */
export async function pushCli(opts) {
  const result = await push(opts);
  return result.code;
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
  // kensho.config.json lives at the parent of the results dir, mirroring
  // what `generate` already does. Best-effort — silent when missing/invalid.
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

function buildAttachmentManifest(inputDir, cases) {
  // We hash + size every attachment listed in cases[].attachments. The case's
  // own `id` namespaces the manifest entry so dedup is per (case, attachment).
  const out = [];
  for (const c of cases) {
    if (!Array.isArray(c.attachments)) continue;
    for (const att of c.attachments) {
      const rel = att.relativePath;
      if (!rel) continue;
      const safeRel = rel.split(/[\\/]+/).join(posix.sep);
      const full = resolve(inputDir, ...safeRel.split(posix.sep));
      if (!full.startsWith(resolve(inputDir))) continue; // path traversal guard
      if (!existsSync(full)) continue;
      const st = statSync(full);
      if (!st.isFile()) continue;
      const buf = readFileSync(full);
      const sha256 = createHash('sha256').update(buf).digest('hex');
      out.push({
        id: `${c.id}::${att.id}`,
        caseId: c.id,
        attachmentId: att.id,
        relativePath: safeRel,
        sizeBytes: st.size,
        sha256,
        contentType: att.mimeType || 'application/octet-stream',
        absolutePath: full, // local-only, stripped before posting
      });
    }
  }
  return out;
}

async function uploadAll(fetchImpl, items, presigned) {
  // Bounded concurrency without a third-party dep: a tiny pool of workers
  // pulling indices off a shared cursor.
  let cursor = 0;
  const workers = [];
  const fail = (err) => { throw err; };
  const next = () => {
    const i = cursor++;
    if (i >= items.length) return null;
    return uploadOne(fetchImpl, items[i], presigned.get(items[i].id)).then(() => next(), fail);
  };
  for (let i = 0; i < Math.min(PARALLELISM, items.length); i++) {
    workers.push(next());
  }
  await Promise.all(workers);
}

async function uploadOne(fetchImpl, item, presign) {
  if (!presign?.url) throw new Error(`missing presigned URL for ${item.relativePath}`);
  const body = readFileSync(item.absolutePath);
  // MinIO/SigV4 rejects requests with unsigned headers. Send ONLY the headers
  // the API marked as signed via presign.headers; let fetch compute
  // Content-Length itself. Add Content-Type only if the signer included it.
  const headers = { ...(presign.headers || {}) };

  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetchImpl(presign.url, { method: 'PUT', body, headers });
    } catch (err) {
      // Network blip — retry once.
      if (attempt === 0) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw err;
    }
    if (res.ok) return;
    if (res.status >= 500 && attempt === 0) {
      await sleep(RETRY_DELAY_MS);
      continue;
    }
    const detail = await safeText(res);
    throw new Error(`PUT ${item.relativePath} → ${res.status} ${detail}`);
  }
}

async function postJson(fetchImpl, url, token, body) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    // Strip absolutePath from attachment entries before serializing.
    body: JSON.stringify(body, (k, v) => (k === 'absolutePath' ? undefined : v)),
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

function classifyHttpError(err) {
  const status = err?.status || 0;
  if (status === 401 || status === 403) return { code: EXIT.AUTH, errors: [err.message] };
  return { code: EXIT.UPLOAD, errors: [err.message] };
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatTotalsLine(summary, totals) {
  const t = summary?.total != null
    ? summary
    : {
        pass: totals?.pass ?? 0,
        fail: totals?.fail ?? 0,
        broken: totals?.broken ?? 0,
        skip: totals?.skip ?? 0,
      };
  return `${t.pass} pass · ${t.fail} fail · ${t.broken} broken · ${t.skip} skipped`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
