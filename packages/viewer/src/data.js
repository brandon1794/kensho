// =============================================================
// loadKenshoData — pure data loader + normalizer.
//
// Fetches `${dataUrl}/index.json` and (lazily) `${dataUrl}/cases/<id>.json`,
// then maps the Kensho v1 schema into the shape the viewer's components
// expect (RUN, ENV, SUITES, RICH_TESTS, …).
//
// Used by:
//   * `assets/data-bridge.jsx` — writes the normalized result onto window
//     globals so the static-report bootstrap path keeps working unchanged.
//   * `src/component.jsx` — feeds the same result into a React Context
//     so the embeddable `<KenshoViewer>` doesn't depend on globals.
//
// Important: this module must stay framework-free. Don't import React.
// =============================================================

const STATUS = { pass: 'passed', fail: 'failed', broken: 'broken', skip: 'skipped' };

export function fmtDuration(ms) {
  if (ms == null) return '—';
  if (ms === 0) return '—';
  if (ms < 1000) return ms + 'ms';
  const totalSec = ms / 1000;
  if (totalSec < 60) {
    const whole = Math.floor(totalSec);
    const remMs = ms - whole * 1000;
    return remMs ? whole + 's ' + remMs + 'ms' : whole + 's';
  }
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return m + 'm ' + s + 's';
}

export function relTime(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return new Date(iso).toLocaleString();
  if (ms < 60_000) return Math.max(1, Math.floor(ms / 1000)) + 's ago';
  if (ms < 3_600_000) return Math.floor(ms / 60_000) + 'm ago';
  if (ms < 86_400_000) return Math.floor(ms / 3_600_000) + 'h ago';
  return Math.floor(ms / 86_400_000) + 'd ago';
}

function inferStepType(s) {
  if (s.phase === 'setup')    return 'setup';
  if (s.phase === 'teardown') return 'teardown';
  if (s.children?.length)     return 'group';
  if (s.assertion)            return 'assertion';
  if (s.network?.length)      return 'http';
  const t = (s.title || '').toLowerCase();
  if (t.includes('navigate') || t.includes('goto') || t.startsWith('open '))  return 'navigation';
  if (t.includes('verify') || t.includes('expect') || t.includes('assert'))   return 'assertion';
  if (t.startsWith('post ') || t.startsWith('get ') || t.includes('http'))    return 'http';
  if (t.includes('select ') || t.includes('insert ') || t.includes('query')) return 'db';
  if (t.startsWith('screenshot'))                                             return 'screenshot';
  return 'action';
}

function mapLog(l) {
  return {
    ts: typeof l.t === 'number'
      ? new Date(l.t).toISOString().slice(11, 23)
      : (typeof l.t === 'string' ? l.t.slice(11, 23) : ''),
    lvl: l.level === 'error' ? 'err' : (l.level || 'info'),
    msg: l.msg || '',
  };
}

// `attachmentBase` is "data/" for the static report (matches existing legacy
// behavior) and `${dataUrl}/` for the embedded component.
function makeMapStep(attachmentBase) {
  function mapStep(s) {
    const out = {
      name: s.title || '(unnamed step)',
      status: STATUS[s.status] || s.status,
      duration: fmtDuration(s.duration),
      type: inferStepType(s),
    };
    if (s.logs?.length) out.logs = s.logs.map(mapLog);
    if (s.children?.length) out.children = s.children.map(mapStep);
    if (s.parameters?.length) {
      out.payload = s.parameters.map(p => `${p.name} = ${p.value}`).join('\n');
    }
    if (s.assertion) {
      out.assertion = {
        passed: s.status === 'pass',
        matcher: s.action || 'expect',
        expected: typeof s.assertion.expected === 'string'
          ? s.assertion.expected
          : JSON.stringify(s.assertion.expected),
        actual: typeof s.assertion.received === 'string'
          ? s.assertion.received
          : JSON.stringify(s.assertion.received),
      };
      if (s.assertion.diff) out.body = s.assertion.diff;
    }
    if (s.network?.length) {
      const n = s.network[0];
      out.request = {
        method: n.method, url: n.url, duration: fmtDuration(n.durationMs),
        ...(n.requestBody ? { body: n.requestBody } : {}),
      };
      out.response = {
        status: n.status, statusText: n.status >= 400 ? 'ERR' : 'OK',
        size: n.sizeBytes ? n.sizeBytes + 'B' : '',
        ...(n.responseBody ? { body: n.responseBody } : {}),
      };
    }
    if (s.attachments?.length) {
      const visual = s.attachments.find(a =>
        a.kind === 'screenshot' || a.kind === 'image' || a.kind === 'video' ||
        (a.mimeType || '').startsWith('image/') || (a.mimeType || '').startsWith('video/')
      );
      if (visual) {
        const url = attachmentBase + (visual.relativePath || '').replace(/^\/+/, '');
        const name = (visual.relativePath || '').split(/[\\/]/).pop() || visual.id || 'attachment';
        const sizeKB = visual.sizeBytes ? (visual.sizeBytes / 1024).toFixed(1) + ' KB' : '';
        out.screenshot = { url, name, size: sizeKB, dimensions: '' };
      }
      out._attachments = s.attachments;
    }
    return out;
  }
  return mapStep;
}

function buildRichTest(c, idx, runStartMs) {
  const startMs = c.startedAt ? Math.max(0, new Date(c.startedAt).getTime() - runStartMs) : 0;
  return {
    id: c.id,
    order: idx + 1,
    name: c.name,
    fullName: c.fullName,
    status: STATUS[c.status] || c.status,
    dur: fmtDuration(c.duration),
    durMs: c.duration || 0,
    start: startMs,
    suite: (c.suite || []).join(' › '),
    suiteChain: c.suite || [],
    severity: c.severity || 'normal',
    retries: c.retries || 0,
    flakeRate: 0,
    avgDurMs: c.duration || 0,
    platform: [c.browser, c.platform].filter(Boolean).join(' · '),
    description: '',
    parameters: [],
    tags: c.tags || [],
    owner: c.owner || '',
    file: c.filePath ? c.filePath + (c.line ? ':' + c.line : '') : '',
    epic: c.behavior?.epic,
    feature: c.behavior?.feature,
    story: c.behavior?.scenario,
    lastRun: c.startedAt ? relTime(c.startedAt) : '',
    bdd: null,
    labels: c.labels || {},
    links: c.links || [],
    error: (c.hasErrors || c.errorPreview) ? {
      kind: c.errorType || 'Error',
      message: c.errorPreview || '',
      stack: '',
    } : null,
    steps: [],
    _summary: c,
    _full: null,
    _stepsLoaded: false,
  };
}

function deriveSuiteTree(cases) {
  const root = { _children: new Map() };
  for (const c of cases) {
    const chain = (c.suite && c.suite.length) ? c.suite : ['Default'];
    let node = root;
    for (let i = 0; i < chain.length; i++) {
      const part = chain[i];
      if (!node._children.has(part)) node._children.set(part, { _name: part, _children: new Map() });
      node = node._children.get(part);
    }
    if (!node._tests) node._tests = [];
    node._tests.push(c.id);
  }
  let auto = 0;
  function toTree(node, parentId) {
    const out = [];
    for (const [name, child] of node._children) {
      const id = parentId + '/' + name;
      const childNodes = toTree(child, id);
      const leaves = (child._tests || []).map(tid => ({ id: id + '/leaf-' + (++auto), testId: tid }));
      const all = [...childNodes, ...leaves];
      if (all.length) out.push({ id, name, children: all });
    }
    return out;
  }
  return toTree(root, 'suite');
}

function _kvBehaviorPickFromLabels(c) {
  // Some adapters populate `case.behavior.{epic,feature,scenario}`; others
  // emit them as labels (`epic`/`feature`/`story`). Read both.
  const labels = c.labels || {};
  return {
    epic: (c.behavior && c.behavior.epic) || labels.epic || labels.Epic,
    feature: (c.behavior && c.behavior.feature) || labels.feature || labels.Feature,
    story: (c.behavior && c.behavior.scenario) || labels.story || labels.Story,
  };
}
function deriveBehaviorTree(cases) {
  const tree = new Map();
  for (const c of cases) {
    const { epic, feature, story } = _kvBehaviorPickFromLabels(c);
    if (!epic && !feature) continue;
    const e = epic || '(unspecified epic)';
    const f = feature || '(unspecified feature)';
    if (!tree.has(e)) tree.set(e, new Map());
    const features = tree.get(e);
    if (!features.has(f)) features.set(f, []);
    features.get(f).push({ caseId: c.id, story: story || c.name });
  }
  let auto = 0;
  const out = [];
  for (const [epic, features] of tree) {
    const eId = 'epic/' + epic;
    const fNodes = [];
    for (const [feature, stories] of features) {
      const fId = eId + '/' + feature;
      const sNodes = stories.map(s => ({ id: fId + '/leaf-' + (++auto), testId: s.caseId }));
      fNodes.push({ id: fId, name: 'Feature · ' + feature, children: sNodes });
    }
    out.push({ id: eId, name: 'Epic · ' + epic, children: fNodes });
  }
  return out;
}

function deriveCategories(cases) {
  const map = new Map();
  for (const c of cases) {
    const isFail = c.status === 'fail' || c.status === 'broken';
    // Always bucket failures, even when the adapter didn't populate
    // errorType/errorPreview — the user expects every failed case to be
    // visible somewhere on Categories.
    if (!isFail && !c.errorType && !c.errorPreview) continue;
    const kind = c.errorType || 'Error';
    const family = c.status === 'broken' ? 'broken' : c.status === 'skip' ? 'skipped' : 'failed';
    const color = family === 'failed' ? 'var(--status-failed)'
      : family === 'broken' ? 'var(--status-broken)'
      : 'var(--status-skipped)';
    if (!map.has(kind)) map.set(kind, { kind, family, color, count: 0, tests: [], description: describeKind(kind) });
    const e = map.get(kind);
    e.count += 1;
    e.tests.push(c.id);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

function describeKind(kind) {
  const map = {
    AssertionError: 'Expected vs. actual mismatch in a test assertion. Most often a real product defect.',
    TimeoutError:   'A wait condition exceeded its budget. Could be a slow service or a missing element.',
    NetworkError:   'Non-2xx response from a backend dependency during the test.',
    Error:          'Generic error — inspect the failing test for details.',
  };
  return map[kind] || ('Failures classified as ' + kind + '.');
}

function deriveTimelineRows(cases, runStartMs) {
  return cases
    .filter(c => c.duration && c.duration > 0)
    .map(c => ({
      id: c.id,
      suite: (c.suite && c.suite[0]) || 'Default',
      name: c.name,
      start: c.startedAt ? Math.max(0, new Date(c.startedAt).getTime() - runStartMs) : 0,
      durMs: c.duration,
      dur: fmtDuration(c.duration),
      status: STATUS[c.status] || c.status,
      platform: [c.browser, c.platform].filter(Boolean).join(' · '),
      severity: c.severity || 'normal',
      retries: c.retries || 0,
      file: c.filePath ? c.filePath + (c.line ? ':' + c.line : '') : '',
    }));
}

function deriveTrendRuns(history, current) {
  const runs = [];
  if (history?.length) {
    for (const h of history) {
      const t = h.totals || {};
      runs.push({
        short: (h.id || '').slice(-4) || h.id,
        passed: t.pass || 0,
        failed: t.fail || 0,
        broken: t.broken || 0,
        skipped: t.skip || 0,
      });
    }
  }
  if (current) runs.push(current);
  if (runs.length === 0 && current) runs.push(current);
  return runs;
}

function deriveDurationHistogram(cases) {
  const buckets = [
    { label: '<100ms',  max: 100 },
    { label: '<500ms',  max: 500 },
    { label: '<1s',     max: 1000 },
    { label: '<2s',     max: 2000 },
    { label: '<5s',     max: 5000 },
    { label: '<10s',    max: 10000 },
    { label: '≥10s',    max: Infinity },
  ];
  return buckets.map(b => ({
    label: b.label,
    n: cases.filter(c => c.duration && c.duration > 0 && c.duration < b.max).length,
  })).map((b, i, arr) => ({
    label: b.label,
    n: i === 0 ? b.n : (b.n - (arr[i - 1]?.n || 0)),
  }));
}

function deriveHistoryRuns(history, current) {
  const out = [];
  if (current) {
    out.push({
      id: current.id,
      when: '2m ago',
      branch: current.branch,
      actor: current.actor,
      passed: current.counts.passed,
      failed: current.counts.failed,
      broken: current.counts.broken,
      skipped: current.counts.skipped,
      dur: current.duration,
      status: current.counts.failed + current.counts.broken > 0 ? 'failed' : 'passed',
    });
  }
  if (history?.length) {
    for (const h of history) {
      const t = h.totals || {};
      const failed = (t.fail || 0) + (t.broken || 0);
      out.push({
        id: '#' + (h.id || '?'),
        when: h.startedAt ? relTime(h.startedAt) : '',
        branch: h.branch || 'main',
        actor: 'kensho',
        passed: t.pass || 0,
        failed: t.fail || 0,
        broken: t.broken || 0,
        skipped: t.skip || 0,
        dur: fmtDuration(h.durationMs),
        status: failed > 0 ? 'failed' : 'passed',
      });
    }
  }
  return out;
}

const ENV_LABEL = {
  ci: 'CI', branch: 'Branch', commit: 'Commit', commitMsg: 'Commit msg',
  author: 'Author', runUrl: 'Run URL', repoUrl: 'Repo URL', os: 'OS', osVersion: 'OS version',
  arch: 'Arch', nodeVersion: 'Node', pythonVersion: 'Python',
  browsers: 'Browsers', workers: 'Workers', stage: 'Stage', baseUrl: 'Base URL',
  appVersion: 'App version', buildNumber: 'Build', release: 'Release',
  device: 'Device', viewport: 'Viewport', region: 'Region', locale: 'Locale',
  timezone: 'Timezone', tunnel: 'Tunnel', trigger: 'Trigger', feature: 'Feature',
};

/**
 * Load and normalize a Kensho run.
 *
 * @param {string} dataUrl
 *        URL (relative or absolute) to a Kensho `data/` directory. The loader
 *        appends `/index.json` and `/cases/<id>.json` to it.
 * @param {object} [opts]
 * @param {(caseId: string) => string} [opts.caseUrl]
 *        Override the per-case URL builder. Default:
 *        `${dataUrl}/cases/${caseId}.json`.
 * @param {typeof fetch} [opts.fetch]
 *        Override the global `fetch` implementation (useful for tests / SSR).
 * @returns {Promise<KenshoState>}
 */
export async function loadKenshoData(dataUrl, opts = {}) {
  if (!dataUrl) throw new Error('loadKenshoData: dataUrl is required');
  const baseUrl = String(dataUrl).replace(/\/+$/, '');
  const fetchImpl = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchImpl) throw new Error('loadKenshoData: no `fetch` available — pass opts.fetch.');
  const caseUrl = opts.caseUrl || ((id) => `${baseUrl}/cases/${id}.json`);
  // Attachments declared on `step.attachments[*].relativePath` are joined to
  // `${baseUrl}/`. For the static report, baseUrl === "data" so the URL ends
  // up "data/attachments/…", matching the legacy behavior. For embedded, it
  // ends up something like "/v1/runs/<id>/data/attachments/…".
  const attachmentBase = baseUrl + '/';
  const mapStep = makeMapStep(attachmentBase);

  const idx = await fetchImpl(`${baseUrl}/index.json`, { cache: 'no-cache' }).then(r => r.json());
  const runStartMs = idx.startedAt ? new Date(idx.startedAt).getTime() : Date.now();
  const totals = idx.totals || {};
  const counts = {
    passed: totals.pass || 0,
    failed: totals.fail || 0,
    broken: totals.broken || 0,
    skipped: totals.skip || 0,
  };

  const run = {
    id: '#' + (idx.runId || 'unknown'),
    branch: idx.env?.branch || (idx.env?.ci === 'local' ? 'local' : 'main'),
    commit: (idx.env?.commit || '').slice(0, 7),
    commitFull: idx.env?.commit || '',
    actor: idx.env?.author || idx.project?.slug || 'kensho',
    startedAt: idx.startedAt ? new Date(idx.startedAt).toLocaleString() : '',
    duration: fmtDuration(idx.durationMs),
    counts,
    repoUrl: idx.env?.repoUrl || '',
    runUrl: idx.env?.runUrl || '',
  };

  const ENV_FIELDS = Object.keys(ENV_LABEL);
  const env = ENV_FIELDS
    .filter(k => idx.env?.[k] != null && idx.env[k] !== '' && (!Array.isArray(idx.env[k]) || idx.env[k].length > 0))
    .map(k => [
      ENV_LABEL[k] || k,
      Array.isArray(idx.env[k]) ? idx.env[k].join(', ') : String(idx.env[k]),
    ]);
  if (idx.env?.vars && typeof idx.env.vars === 'object') {
    for (const [k, v] of Object.entries(idx.env.vars)) {
      if (v != null && v !== '') env.push([k, String(v)]);
    }
  }

  const cases = idx.cases || [];
  const richTests = {};
  cases.forEach((c, i) => { richTests[c.id] = buildRichTest(c, i, runStartMs); });

  const bySuite = new Map();
  for (const c of cases) {
    const key = (c.suite && c.suite[0]) || 'Default';
    const arr = bySuite.get(key) || [];
    arr.push(c);
    bySuite.set(key, arr);
  }
  const suites = [...bySuite.entries()].map(([name, cs]) => {
    const segs = ['pass', 'fail', 'broken', 'skip']
      .map(k => ({ k: STATUS[k], n: cs.filter(c => c.status === k).length }))
      .filter(s => s.n > 0);
    return { name, segs, total: cs.length };
  });

  const tests = cases.map(c => ({
    ns: '',
    name: c.name,
    status: STATUS[c.status] || c.status,
    duration: fmtDuration(c.duration),
    last: c.startedAt ? relTime(c.startedAt) : '',
    retries: c.retries,
    richId: c.id,
  }));

  const suiteTree = deriveSuiteTree(cases);
  const behaviorTree = deriveBehaviorTree(cases);
  const categories = deriveCategories(cases);
  const timelineTests = deriveTimelineRows(cases, runStartMs);
  const trendRuns = deriveTrendRuns(idx.history, {
    short: (idx.runId || '').slice(-4) || idx.runId,
    passed: counts.passed, failed: counts.failed,
    broken: counts.broken, skipped: counts.skipped,
  });
  const histogram = deriveDurationHistogram(cases);
  const historyRuns = deriveHistoryRuns(idx.history, run);

  const reportType = idx.reportType
    || (idx.framework?.name === 'playwright' ? 'e2e'
      : (idx.framework?.name === 'jest' || idx.framework?.name === 'vitest' || idx.framework?.name === 'pytest' ? 'unit' : 'mixed'));

  // Per-case JSON cache local to this state instance — keeps two embedded
  // viewers from clobbering each other's case caches.
  const caseCache = {};
  async function loadCase(id) {
    if (!id) return null;
    if (caseCache[id]) return caseCache[id];
    try {
      const r = await fetchImpl(caseUrl(id), { cache: 'no-cache' });
      caseCache[id] = await r.json();
      return caseCache[id];
    } catch (e) {
      console.error('[kensho] failed to load case', id, e);
      return null;
    }
  }

  async function ensureCaseLoaded(richTest) {
    if (!richTest || richTest._stepsLoaded) return richTest;
    const full = await loadCase(richTest.id);
    if (!full) { richTest._stepsLoaded = true; return richTest; }
    richTest._full = full;
    richTest.description = full.description || richTest.description;
    richTest.parameters = (full.parameters || []).map(p => [p.name, p.value]);
    if (full.behavior?.gherkin?.length) {
      const text = full.behavior.gherkin.join(' ');
      const m = text.match(/given\s+(.+?)\s+when\s+(.+?)\s+then\s+(.+)/i);
      if (m) richTest.bdd = { given: m[1].trim(), when: m[2].trim(), then: m[3].trim() };
    }
    if (full.errors?.length) {
      const e = full.errors[0];
      richTest.error = { kind: e.type || 'Error', message: e.message || '', stack: e.stack || '' };
    }
    richTest.steps = (full.steps || []).map(mapStep);
    richTest.attachments = full.attachments || [];
    richTest.logs = (full.logs || []).map(mapLog);
    richTest.history = full.history || [];
    richTest._stepsLoaded = true;
    return richTest;
  }

  return {
    kenshoIndex: idx,
    reportType,
    run,
    env,
    suites,
    tests,
    richTests,
    suiteTree,
    behaviorTree,
    categories,
    timelineTests,
    trendRuns,
    histogram,
    historyRuns,
    ensureCaseLoaded,
    loadCase,
    fmtDuration,
    relTime,
    // Helpers for the data-bridge adapter (mostly unused outside it).
    _baseUrl: baseUrl,
    _attachmentBase: attachmentBase,
  };
}
