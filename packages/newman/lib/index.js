// newman-reporter-kensho — Newman custom reporter that emits Kensho v1
// results. Newman is CommonJS so this file must stay CJS.
//
// Newman discovers reporters named newman-reporter-<name>. Run with:
//   newman run collection.json -r kensho
//
// Reporter signature (per Newman docs):
//   function (emitter, reporterOptions, collectionRunOptions)

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Inlined from @kaizenreport/kensho-schema. The schema package is ESM-only
// and Newman runs in CJS, so we duplicate the small pieces we need rather
// than fight the module system. Keep these in sync with packages/schema/index.js.
const SCHEMA_VERSION = 'kensho/v1';

function stableCaseId(fullName, filePath) {
  const s = String(fullName || '') + '::' + String(filePath || '');
  let h1 = 0x811c9dc5 >>> 0;
  let h2 = 0x01000193 >>> 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return 'tc_' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

function computeTotals(cases) {
  const t = { pass: 0, fail: 0, broken: 0, skip: 0 };
  for (const c of cases) {
    if (c.status in t) t[c.status]++;
  }
  return t;
}

function emptyRun(opts) {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: opts?.id || ('run_' + now.replace(/[^0-9]/g, '').slice(0, 14)),
    project: opts?.project || { name: 'Unknown', slug: 'unknown' },
    framework: opts?.framework || { name: 'newman', version: '0.0.0' },
    env: opts?.env || { ci: 'local' },
    startedAt: opts?.startedAt || now,
    finishedAt: opts?.finishedAt || now,
    totals: { pass: 0, fail: 0, broken: 0, skip: 0 },
    durationMs: 0,
    testCases: [],
  };
}

// Tiny status-only validator — adapter writes pass through `kensho validate`
// which uses the canonical schema package.
function validateRun(run) {
  const errors = [];
  if (!run || typeof run !== 'object') return { ok: false, errors: ['run must be an object'] };
  if (run.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion must be "${SCHEMA_VERSION}"`);
  if (!run.id) errors.push('missing id');
  if (!run.project?.name || !run.project?.slug) errors.push('missing project.name/slug');
  if (!run.framework?.name) errors.push('missing framework.name');
  if (!Array.isArray(run.testCases)) errors.push('testCases must be array');
  return { ok: errors.length === 0, errors };
}

function _normalizeGitUrl(u) {
  if (!u) return undefined;
  const m = String(u).match(/^(?:ssh:\/\/)?git@([^:/]+)[:/](.+?)(?:\.git)?$/);
  if (m) return `https://${m[1]}/${m[2]}`;
  return String(u).replace(/\.git$/, '');
}

function envInfo() {
  const e = process.env;
  const isCI = !!e.CI;
  const repoUrl = e.KR_REPO_URL
    || (e.GITHUB_SERVER_URL && e.GITHUB_REPOSITORY ? `${e.GITHUB_SERVER_URL}/${e.GITHUB_REPOSITORY}` : null)
    || e.CI_PROJECT_URL || e.BITBUCKET_GIT_HTTP_ORIGIN
    || _normalizeGitUrl(e.BUILD_REPOSITORY_URI || e.CIRCLE_REPOSITORY_URL || e.BUILDKITE_REPO || e.GIT_URL);
  const runUrl = e.KR_RUN_URL
    || (e.GITHUB_SERVER_URL && e.GITHUB_REPOSITORY && e.GITHUB_RUN_ID
        ? `${e.GITHUB_SERVER_URL}/${e.GITHUB_REPOSITORY}/actions/runs/${e.GITHUB_RUN_ID}` : null)
    || e.CI_PIPELINE_URL || e.CIRCLE_BUILD_URL || e.BUILDKITE_BUILD_URL || e.BUILD_URL;
  return {
    ci: e.GITHUB_ACTIONS  ? 'github-actions'
      : e.CIRCLECI        ? 'circleci'
      : e.GITLAB_CI       ? 'gitlab'
      : e.JENKINS_URL     ? 'jenkins'
      : e.BUILDKITE       ? 'buildkite'
      : e.TF_BUILD        ? 'azure-devops'
      : isCI              ? 'unknown'
      : 'local',
    branch: e.KR_BRANCH || e.GITHUB_REF_NAME || e.CIRCLE_BRANCH || e.CI_COMMIT_REF_NAME || e.BUILDKITE_BRANCH || e.BUILD_SOURCEBRANCHNAME,
    commit: e.KR_COMMIT || e.GITHUB_SHA || e.CIRCLE_SHA1 || e.CI_COMMIT_SHA || e.BUILDKITE_COMMIT || e.BUILD_SOURCEVERSION,
    author: e.KR_AUTHOR || e.GITHUB_ACTOR || e.GITLAB_USER_LOGIN,
    runUrl: runUrl || undefined,
    repoUrl: repoUrl || undefined,
    os: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
  };
}

function shortId(prefix) {
  return prefix + '-' + Math.random().toString(36).slice(2, 10);
}

function safeStr(v, max = 64 * 1024) {
  if (v == null) return undefined;
  if (typeof v === 'string') return v.length > max ? v.slice(0, max) + `\n…[truncated ${v.length - max} bytes]` : v;
  if (Buffer.isBuffer(v)) {
    const s = v.toString('utf8');
    return s.length > max ? s.slice(0, max) + `\n…[truncated ${s.length - max} bytes]` : s;
  }
  try {
    const s = JSON.stringify(v);
    return s.length > max ? s.slice(0, max) + '…' : s;
  } catch { return String(v); }
}

function headersToObject(headers) {
  const out = {};
  if (!headers) return out;
  // Postman header lists are PropertyList-like; .all() returns [{key, value, disabled}]
  const list = typeof headers.all === 'function' ? headers.all() : Array.isArray(headers) ? headers : [];
  for (const h of list) {
    if (!h || h.disabled) continue;
    const k = h.key || h.name;
    const v = h.value;
    if (k != null) out[String(k)] = String(v == null ? '' : v);
  }
  return out;
}

function severityFromTags(tags) {
  for (const t of tags || []) {
    const m = /^@?(blocker|critical|normal|minor|trivial)$/i.exec(t);
    if (m) return m[1].toLowerCase();
  }
  return undefined;
}

function extractInlineTags(s) {
  if (!s) return [];
  const tags = [];
  const re = /@([\w-]+)/g;
  let m;
  while ((m = re.exec(s))) tags.push(m[1]);
  return tags;
}

// Walk parents of an item to detect folder-name conventions like @blocker/.
function parentTags(item) {
  const tags = [];
  let p = item && item.parent ? item.parent() : null;
  while (p) {
    if (p.name) tags.push(...extractInlineTags(p.name));
    p = p.parent ? p.parent() : null;
  }
  return tags;
}

// Build behavior tree: collection name → epic, deepest folder → feature, item → scenario.
function behaviorOf(item, collectionName) {
  const folders = [];
  let p = item && item.parent ? item.parent() : null;
  while (p) {
    // Skip the collection itself; gather only folders.
    if (p.name && p.parent && p.parent()) folders.unshift(p.name);
    p = p.parent ? p.parent() : null;
  }
  const out = {};
  if (collectionName) out.epic = collectionName;
  if (folders.length) out.feature = folders[folders.length - 1];
  if (item && item.name) out.scenario = item.name;
  return Object.keys(out).length ? out : undefined;
}

function suiteOf(item) {
  const folders = [];
  let p = item && item.parent ? item.parent() : null;
  while (p) {
    if (p.name && p.parent && p.parent()) folders.unshift(p.name);
    p = p.parent ? p.parent() : null;
  }
  return folders;
}

// ------------------------- Reporter -------------------------

function KenshoNewmanReporter(emitter, reporterOptions = {}, collectionRunOptions = {}) {
  const cwd = process.cwd();
  const opts = {
    output: reporterOptions.output || process.env.KENSHO_OUTPUT || 'kensho-results',
    projectName: reporterOptions.projectName || process.env.KENSHO_PROJECT_NAME,
    projectSlug: reporterOptions.projectSlug || process.env.KENSHO_PROJECT_SLUG,
    runId: reporterOptions.runId,
  };
  const outputDir = path.resolve(cwd, opts.output);
  const casesDir = path.resolve(outputDir, 'cases');
  const attachmentsDir = path.resolve(outputDir, 'attachments');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(casesDir, { recursive: true });
  fs.mkdirSync(attachmentsDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const runId = opts.runId || ('run_' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14));
  const collectionName =
    (collectionRunOptions.collection && (collectionRunOptions.collection.name || (collectionRunOptions.collection.info && collectionRunOptions.collection.info.name)))
    || 'Postman Collection';

  // We accumulate per-item state since one item can fire several events:
  // beforeRequest → request → assertion(*) → item.
  // Newman's `item` event marks the item finished.
  const inflight = new Map(); // cursorRef -> { caseObj, requestStep, assertionSteps[], startMs }
  const casesById = new Map();
  let collectionSeverity;

  function cursorKey(cursor) {
    // cursor.ref is unique per iteration+item.
    return cursor && (cursor.ref || `${cursor.iteration}:${cursor.position}`);
  }

  emitter.on('start', (_err, _args) => {
    // Detect collection-level severity from name tag (e.g. "Acme API @critical").
    if (collectionName) {
      const sev = severityFromTags(extractInlineTags(collectionName));
      if (sev) collectionSeverity = sev;
    }
  });

  emitter.on('beforeItem', (_err, args) => {
    const item = args && args.item;
    if (!item) return;
    const key = cursorKey(args.cursor);
    const itemName = item.name || 'unnamed';
    const folders = suiteOf(item);
    const fullName = folders.concat(itemName).join(' / ');
    const filePath = collectionRunOptions.collection
      && (collectionRunOptions.collection.info && collectionRunOptions.collection.info.name)
      ? `collection://${collectionRunOptions.collection.info.name}`
      : `collection://${collectionName}`;
    let id = stableCaseId(fullName + ':' + (args.cursor && args.cursor.iteration != null ? args.cursor.iteration : 0), filePath);
    if (casesById.has(id)) {
      let i = 2;
      while (casesById.has(id + '_' + i)) i++;
      id = id + '_' + i;
    }
    const itemTags = (item.events && []) || [];
    const tags = Array.from(new Set([
      ...extractInlineTags(itemName),
      ...parentTags(item),
    ]));
    const severity = severityFromTags(tags) || severityFromTags(parentTags(item)) || collectionSeverity;
    const t0 = Date.now();
    const startedAtCase = new Date(t0).toISOString();
    const caseObj = {
      id,
      name: itemName,
      fullName,
      filePath,
      suite: folders,
      tags,
      severity,
      status: 'pass',
      startedAt: startedAtCase,
      finishedAt: startedAtCase,
      duration: 0,
      retries: 0,
      platform: process.platform,
      behavior: behaviorOf(item, collectionName),
      steps: [],
      logs: [],
    };
    inflight.set(key, { caseObj, requestStep: null, startMs: t0, errors: [], skipped: false });
  });

  emitter.on('beforeRequest', (_err, args) => {
    const key = cursorKey(args.cursor);
    const state = inflight.get(key);
    if (!state) return;
    const item = args.item;
    const req = args.request;
    if (!req) return;
    const stepStart = Date.now();
    const requestStep = {
      id: shortId('step'),
      title: `${(req.method || 'GET')} ${urlOf(req.url)}`,
      action: 'http',
      status: 'pass',
      startedAt: new Date(stepStart).toISOString(),
      duration: 0,
      // Custom request/response hosted on the step. The schema's `step.dom`
      // can't fit this, but the viewer reads `step.request` and `step.response`.
      request: {
        method: req.method || 'GET',
        url: urlOf(req.url),
        headers: headersToObject(req.headers),
        body: bodyOf(req.body),
      },
      children: [],
    };
    state.requestStep = requestStep;
    state.requestStartMs = stepStart;
    state.caseObj.steps.push(requestStep);
  });

  emitter.on('request', (err, args) => {
    const key = cursorKey(args.cursor);
    const state = inflight.get(key);
    if (!state) return;
    const step = state.requestStep;
    if (!step) return;
    const resp = args.response;
    const requestErr = err;
    const dur = Math.max(0, Date.now() - (state.requestStartMs || Date.now()));
    step.duration = dur;
    if (resp) {
      const stream = resp.stream;
      const bodyStr = stream && Buffer.isBuffer(stream)
        ? stream.toString('utf8')
        : (resp.body || (typeof resp.text === 'function' ? resp.text() : ''));
      step.response = {
        status: resp.code || 0,
        statusText: resp.status || '',
        headers: headersToObject(resp.headers),
        body: safeStr(bodyStr),
        sizeBytes: typeof resp.size === 'function' ? (resp.size().total || 0) : undefined,
        durationMs: dur,
      };
      if (resp.code && resp.code >= 500 && !state.errors.length) {
        state.errors.push({
          message: `HTTP ${resp.code} ${resp.status || 'Server Error'}`,
          stack: '',
          type: 'HTTPError',
        });
        state.broken = true;
      }
    }
    if (requestErr) {
      step.status = 'fail';
      state.errors.push({
        message: String(requestErr.message || requestErr),
        stack: requestErr.stack || '',
        type: requestErr.name || 'NewmanRequestError',
      });
      state.broken = true;
    }
  });

  emitter.on('assertion', (err, args) => {
    const key = cursorKey(args.cursor);
    const state = inflight.get(key);
    if (!state) return;
    const t0 = Date.now();
    const status = args.skipped ? 'skip' : (err ? 'fail' : 'pass');
    const child = {
      id: shortId('step'),
      title: args.assertion || 'assertion',
      action: 'expect',
      status,
      startedAt: new Date(t0).toISOString(),
      duration: 0,
    };
    if (err) {
      child.assertion = {
        expected: err.expected,
        received: err.actual,
        diff: err.message,
        stack: err.stack,
      };
      state.errors.push({
        message: String(err.message || err).split('\n')[0],
        stack: err.stack || '',
        type: err.name || 'AssertionError',
      });
    }
    if (state.requestStep) {
      state.requestStep.children = state.requestStep.children || [];
      state.requestStep.children.push(child);
    } else {
      state.caseObj.steps.push(child);
    }
  });

  emitter.on('console', (_err, args) => {
    const key = cursorKey(args && args.cursor);
    const state = inflight.get(key);
    if (!state) return;
    const lvl = (args.level === 'warn' || args.level === 'error') ? args.level : 'info';
    const msg = (args.messages || []).map(safeStr).join(' ');
    const t0 = Date.parse(state.caseObj.startedAt) || Date.now();
    state.caseObj.logs.push({
      t: Math.max(0, Date.now() - t0),
      level: lvl,
      msg,
    });
  });

  emitter.on('item', (_err, args) => {
    const key = cursorKey(args.cursor);
    const state = inflight.get(key);
    if (!state) return;
    const c = state.caseObj;
    const dur = Math.max(0, Date.now() - state.startMs);
    c.duration = dur;
    c.finishedAt = new Date(Date.parse(c.startedAt) + dur).toISOString();
    // Pre-request meta override: if pre-request set kensho_severity / kensho_tag(s)
    // via pm.environment, surface them here. Newman exposes the environment via
    // collectionRunOptions.environment on `args.environment` (varies by version).
    const env = (args && args.environment) || (collectionRunOptions && collectionRunOptions.environment);
    if (env) {
      const sev = readEnv(env, 'kensho_severity');
      if (sev && !c.severity) c.severity = String(sev).toLowerCase();
      const extraTags = readEnv(env, 'kensho_tags');
      if (extraTags) c.tags = Array.from(new Set([...c.tags, ...String(extraTags).split(/[\s,]+/).filter(Boolean)]));
    }

    if (state.errors.length) c.errors = state.errors;
    if (state.skipped) c.status = 'skip';
    else if (state.errors.length) {
      const onlyAssertion = state.errors.every(e => (e.type || '').toLowerCase().includes('assertion'));
      c.status = onlyAssertion ? 'fail' : 'broken';
    } else c.status = 'pass';

    if (!c.errors?.length) delete c.errors;
    if (!c.logs?.length) delete c.logs;
    if (!c.behavior) delete c.behavior;
    if (!c.severity) delete c.severity;

    casesById.set(c.id, c);
    try {
      fs.writeFileSync(path.join(casesDir, c.id + '.json'), JSON.stringify(c, null, 2));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[kensho] failed to write case:', e?.message);
    }
    inflight.delete(key);
  });

  emitter.on('done', (_err, _summary) => {
    const cases = [...casesById.values()];
    const finishedAt = new Date().toISOString();
    const run = emptyRun({
      id: runId,
      project: {
        name: opts.projectName || collectionName || 'Newman Run',
        slug: opts.projectSlug || slugify(opts.projectName || collectionName || 'newman-run'),
      },
      framework: { name: 'newman', version: process.env.NEWMAN_VERSION || (collectionRunOptions && collectionRunOptions.newmanVersion) || 'unknown' },
      env: envInfo(),
      startedAt,
    });
    run.finishedAt = finishedAt;
    run.durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
    run.testCases = cases;
    run.totals = computeTotals(cases);
    try {
      fs.writeFileSync(path.join(outputDir, 'run.json'), JSON.stringify(run, null, 2));
      const v = validateRun(run);
      if (!v.ok) {
        // eslint-disable-next-line no-console
        console.warn('[kensho] run.json failed validation:');
        for (const e of v.errors.slice(0, 8)) console.warn('  -', e);
      }
      // eslint-disable-next-line no-console
      console.log(`[kensho] wrote ${cases.length} cases + run.json to ${outputDir}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[kensho] newman done failed:', e?.message);
    }
  });
}

function urlOf(u) {
  if (!u) return '';
  if (typeof u === 'string') return u;
  if (typeof u.toString === 'function') {
    try { return u.toString(); } catch { /* fallthrough */ }
  }
  if (u.raw) return u.raw;
  return '';
}

function bodyOf(body) {
  if (!body) return undefined;
  if (typeof body === 'string') return safeStr(body);
  if (body.mode === 'raw' && body.raw != null) return safeStr(body.raw);
  if (body.mode === 'urlencoded' && body.urlencoded) {
    const list = typeof body.urlencoded.all === 'function' ? body.urlencoded.all() : body.urlencoded;
    return safeStr(list.map(p => `${p.key}=${p.value || ''}`).join('&'));
  }
  if (body.mode === 'formdata' && body.formdata) {
    const list = typeof body.formdata.all === 'function' ? body.formdata.all() : body.formdata;
    return safeStr(`(formdata) ` + list.map(p => p.key).join(', '));
  }
  if (body.mode === 'file') return '(file upload)';
  return safeStr(body);
}

function readEnv(env, key) {
  if (!env || !key) return undefined;
  if (typeof env.get === 'function') return env.get(key);
  if (env.values && typeof env.values.get === 'function') return env.values.get(key);
  if (Array.isArray(env.values)) {
    const v = env.values.find(x => x.key === key);
    return v && v.value;
  }
  return env[key];
}

function slugify(s) {
  return String(s || 'newman-run')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'newman-run';
}

module.exports = KenshoNewmanReporter;
module.exports.default = KenshoNewmanReporter;
