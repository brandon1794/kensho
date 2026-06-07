// @kaizenreport/kensho-k6 — handleSummary helper for k6.
//
// Designed to run inside k6's Goja runtime: zero external imports, no
// process.* / require / fs. The user calls `kenshoSummary(data, opts)` from
// inside `handleSummary`, k6 writes the returned files via its built-in
// summary mechanism.
//
// Same file is re-exported from dist/index.js so Node tooling can import it
// directly and write the returned files itself.

const SCHEMA_VERSION = 'kensho/v1';

// FNV-1a + secondary hash, identical to @kaizenreport/kensho-schema's
// stableCaseId so case ids match between adapters.
function stableCaseId(fullName, filePath) {
  const s = String(fullName || '') + '::' + String(filePath || '');
  let h1 = 0x811c9dc5 >>> 0;
  let h2 = 0x01000193 >>> 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return 'tc_' + pad8(h1.toString(16)) + pad8(h2.toString(16));
}
function imul(a, b) {
  // Math.imul exists in modern engines including Goja, but be defensive.
  if (typeof Math.imul === 'function') return Math.imul(a, b);
  const ah = (a >>> 16) & 0xffff, al = a & 0xffff;
  const bh = (b >>> 16) & 0xffff, bl = b & 0xffff;
  return ((al * bl) + (((ah * bl + al * bh) << 16) >>> 0)) | 0;
}
function pad8(s) { while (s.length < 8) s = '0' + s; return s.slice(0, 8); }

function shortId(prefix) {
  return prefix + '-' + Math.floor(Math.random() * 1e9).toString(36);
}

function nowIso() { return new Date().toISOString(); }

function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function metricValue(m) {
  if (!m || !m.values) return undefined;
  const v = m.values;
  if (typeof v.avg === 'number') return v.avg;
  if (typeof v.rate === 'number') return v.rate;
  if (typeof v.count === 'number') return v.count;
  if (typeof v.value === 'number') return v.value;
  if (typeof v.p95 === 'number') return v.p95;
  return undefined;
}

function summarizeMetrics(metrics) {
  const out = {};
  if (!metrics) return out;
  const want = [
    'http_req_duration', 'http_req_failed', 'http_req_blocked',
    'http_reqs', 'iterations', 'iteration_duration', 'vus', 'vus_max',
    'data_sent', 'data_received', 'checks',
  ];
  for (const k of want) {
    const m = metrics[k];
    if (!m) continue;
    const v = m.values || {};
    if (typeof v.avg === 'number') out[k + '_avg_ms'] = String(round(v.avg));
    if (typeof v['p(95)'] === 'number') out[k + '_p95_ms'] = String(round(v['p(95)']));
    if (typeof v.count === 'number') out[k + '_count'] = String(v.count);
    if (typeof v.rate === 'number') out[k + '_rate'] = String(round(v.rate, 4));
    if (typeof v.value === 'number') out[k + '_value'] = String(round(v.value));
    if (typeof v.passes === 'number') out[k + '_passes'] = String(v.passes);
    if (typeof v.fails === 'number') out[k + '_fails'] = String(v.fails);
  }
  return out;
}

function round(n, decimals = 0) {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

// Walk the k6 root group → a list of { groupPath, checks[] } where checks have
// { name, passes, fails, path }.
function walkGroup(group, parentPath, out) {
  const path = group.name ? (parentPath ? parentPath + ' / ' + group.name : group.name) : parentPath;
  const checks = (group.checks || []).map(c => ({
    name: c.name,
    passes: c.passes || 0,
    fails: c.fails || 0,
    path,
  }));
  if (checks.length || (!group.groups || !group.groups.length)) {
    out.push({ path: path || '', checks });
  }
  for (const g of group.groups || []) walkGroup(g, path, out);
}

function inferScenarios(data) {
  // k6 doesn't always tag checks with their scenario name in summary data.
  // Best effort: read options.scenarios names; fall back to a single
  // "default" scenario containing all root-level checks.
  const opts = (data && data.options && data.options.scenarios) || {};
  const names = Object.keys(opts);
  return names.length ? names : ['default'];
}

/**
 * Convert a k6 summary `data` object into a Kensho results bundle.
 *
 * @param {object} data — k6's `handleSummary(data)` argument.
 * @param {{
 *   project?: { name?: string, slug?: string, url?: string },
 *   runId?: string,
 *   maxSteps?: number,         // cap synthetic per-iteration HTTP steps (default 50)
 *   output?: string,           // prefix for file paths (default 'kensho-results')
 *   framework?: { name?: string, version?: string },
 *   env?: object,              // merged into run.env
 * }} [opts]
 * @returns {Object<string, string>} object whose keys are file paths and
 *   values are stringified contents — feed this directly to `return` from
 *   `handleSummary`.
 */
export function kenshoSummary(data, opts = {}) {
  const out = {};
  const prefix = (opts.output || 'kensho-results').replace(/\/+$/, '');
  const projectName = (opts.project && opts.project.name) || 'k6 Run';
  const projectSlug = (opts.project && opts.project.slug) || slugify(projectName);
  const runId = opts.runId || ('run_' + nowIso().replace(/[^0-9]/g, '').slice(0, 14));
  const maxSteps = Number.isFinite(opts.maxSteps) ? opts.maxSteps : 50;

  const startedAt = (data && data.state && data.state.testRunDurationMs)
    ? new Date(Date.now() - data.state.testRunDurationMs).toISOString()
    : nowIso();
  const finishedAt = nowIso();

  const cases = [];
  const addCase = (c) => {
    cases.push(c);
    out[`${prefix}/cases/${c.id}.json`] = JSON.stringify(c, null, 2);
  };

  const filePath = `k6://${projectSlug}`;
  const rootGroups = [];
  if (data && data.root_group) walkGroup(data.root_group, '', rootGroups);

  // ---------- Scenarios → cases (one per scenario name) ------------
  const scenarios = inferScenarios(data);
  const scenarioCheckBuckets = {};
  for (const s of scenarios) scenarioCheckBuckets[s] = [];

  // k6 summaries don't always tag check names by scenario. Heuristic: if a
  // group's name matches a scenario name (or contains "scenario:<name>"),
  // route its checks there. Otherwise dump everything into the first
  // scenario so checks aren't lost.
  for (const g of rootGroups) {
    const lower = (g.path || '').toLowerCase();
    const hit = scenarios.find(s => lower.includes(s.toLowerCase()));
    const bucket = hit || scenarios[0];
    scenarioCheckBuckets[bucket].push(...g.checks);
  }

  for (const scenarioName of scenarios) {
    const id = stableCaseId('scenario:' + scenarioName, filePath);
    const checks = scenarioCheckBuckets[scenarioName] || [];
    const checkSteps = checks.map((ch) => {
      const stepStatus = ch.fails > 0 ? 'fail' : 'pass';
      const step = {
        id: shortId('step'),
        title: ch.name + (ch.path ? `  (${ch.path})` : ''),
        action: 'check',
        status: stepStatus,
        startedAt,
        duration: 0,
      };
      if (ch.fails > 0) {
        step.assertion = {
          expected: 'all checks pass',
          received: `${ch.fails} of ${ch.fails + ch.passes} failed`,
          diff: undefined,
          stack: undefined,
        };
      }
      return step;
    });

    // Per-iteration HTTP samples opt-in via data.kenshoSamples. If a sample
    // tags itself with .scenario, we route it to that scenario; otherwise
    // we surface the first N globally on the first scenario only.
    const httpSamples = httpSampleSteps(data, maxSteps, scenarioName, scenarios);

    const failed = checkSteps.filter(s => s.status === 'fail').length;
    const status = checks.length === 0 ? (httpSamples.length ? 'pass' : 'skip')
      : (failed === 0 ? 'pass' : 'fail');

    const c = {
      id,
      name: scenarioName,
      fullName: 'scenario / ' + scenarioName,
      filePath,
      suite: ['scenarios'],
      tags: ['k6', 'scenario'],
      status,
      startedAt,
      finishedAt,
      duration: safeNum(data && data.state && data.state.testRunDurationMs, 0) | 0,
      retries: 0,
      steps: checkSteps.concat(httpSamples),
      behavior: { epic: projectName, feature: 'scenarios', scenario: scenarioName },
    };
    if (failed > 0) {
      c.errors = [{
        message: `${failed} check(s) failed in scenario ${scenarioName}`,
        stack: '',
        type: 'CheckFailure',
      }];
    }
    addCase(c);
  }

  // ---------- Thresholds → top-level cases (one per threshold) ----------
  const thresholdCases = thresholdsToCases(data, filePath, projectName, startedAt, finishedAt);
  for (const c of thresholdCases) addCase(c);

  // ---------- Run manifest ---------------------------------------------
  const totals = computeTotals(cases);
  const env = Object.assign(
    {
      ci: 'unknown',
      os: (data && data.options && data.options.execution && data.options.execution.platform) || undefined,
      vars: summarizeMetrics(data && data.metrics),
    },
    opts.env || {},
  );
  if (env.os == null) delete env.os;

  const run = {
    schemaVersion: SCHEMA_VERSION,
    id: runId,
    project: Object.assign({ name: projectName, slug: projectSlug }, opts.project || {}),
    framework: Object.assign({ name: 'k6', version: 'unknown' }, opts.framework || {}),
    env,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
    totals,
    testCases: cases,
  };

  out[`${prefix}/run.json`] = JSON.stringify(run, null, 2);
  return out;
}

function thresholdsToCases(data, filePath, projectName, startedAt, finishedAt) {
  const out = [];
  const metrics = (data && data.metrics) || {};
  for (const metricName of Object.keys(metrics)) {
    const m = metrics[metricName];
    const t = m && m.thresholds;
    if (!t) continue;
    for (const expr of Object.keys(t)) {
      const result = t[expr] || {};
      const ok = result.ok !== false; // k6 sets ok:false on failure
      const status = ok ? 'pass' : 'fail';
      const id = stableCaseId('threshold:' + metricName + ':' + expr, filePath);
      const value = metricValue(m);
      const c = {
        id,
        name: `${metricName}: ${expr}`,
        fullName: 'threshold / ' + metricName + ' / ' + expr,
        filePath,
        suite: ['thresholds', metricName],
        tags: ['k6', 'threshold'],
        status,
        startedAt,
        finishedAt,
        duration: 0,
        retries: 0,
        behavior: { epic: projectName, feature: 'thresholds', scenario: metricName },
        steps: [{
          id: shortId('step'),
          title: `${metricName} ${expr} (observed: ${value == null ? 'n/a' : round(value, 2)})`,
          action: 'threshold',
          status,
          startedAt,
          duration: 0,
          assertion: ok ? undefined : {
            expected: expr,
            received: value == null ? null : value,
            diff: undefined,
            stack: undefined,
          },
        }],
      };
      if (!ok) {
        c.errors = [{
          message: `Threshold ${expr} on ${metricName} failed (observed ${value})`,
          stack: '',
          type: 'ThresholdFailure',
        }];
      }
      out.push(c);
    }
  }
  return out;
}

function httpSampleSteps(data, maxSteps, scenarioName, allScenarios) {
  // k6 summary doesn't include per-request samples by default — but if the
  // user runs with `--out json=...` and pipes a small subset into
  // `data.kenshoSamples`, surface them. This is opt-in.
  const all = (data && data.kenshoSamples && Array.isArray(data.kenshoSamples)) ? data.kenshoSamples : [];
  let mine;
  if (all.some(s => s && s.scenario)) {
    mine = all.filter(s => s && s.scenario === scenarioName);
  } else {
    // Untagged samples: bucket onto the first scenario only so we don't
    // duplicate them across all scenario cases.
    mine = (allScenarios && allScenarios[0] === scenarioName) ? all : [];
  }
  return mine.slice(0, maxSteps).map((s) => ({
    id: shortId('step'),
    title: `${s.method || 'GET'} ${s.url || ''}`,
    action: 'http',
    status: (s.status >= 200 && s.status < 400) ? 'pass' : 'fail',
    startedAt: s.startedAt || nowIso(),
    duration: safeNum(s.durationMs, 0),
    request: {
      method: s.method || 'GET',
      url: s.url || '',
      headers: s.requestHeaders || {},
      body: s.requestBody,
    },
    response: {
      status: s.status || 0,
      statusText: s.statusText || '',
      headers: s.responseHeaders || {},
      body: s.responseBody,
      durationMs: safeNum(s.durationMs, 0),
    },
  }));
}

function computeTotals(cases) {
  const t = { pass: 0, fail: 0, broken: 0, skip: 0 };
  for (const c of cases) {
    if (c.status in t) t[c.status]++;
  }
  return t;
}

function slugify(s) {
  return String(s || 'k6-run').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'k6-run';
}

/**
 * Convenience: drop the result of kenshoSummary into k6's expected
 * handleSummary return shape, plus a "stdout" textual summary.
 */
export function handleSummary(data, opts) {
  return kenshoSummary(data, opts);
}

export default kenshoSummary;
