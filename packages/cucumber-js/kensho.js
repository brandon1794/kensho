// @kaizenreport/kensho-cucumber-js/kensho — the Kensho annotation API for
// Cucumber-JS step definitions, plus a tiny shared scratch the formatter reads.
//
// Cucumber-JS runs step definitions serially in the same process as the
// formatter. The formatter opens a scratch buffer at `testCaseStarted` and
// closes/drains it at `testCaseFinished`; in between, step definitions call
// `kensho.*` which mutate the open buffer. The formatter then folds the buffer
// into the Kensho case it builds from the message stream.
//
//   import { Given } from '@cucumber/cucumber';
//   import { kensho } from '@kaizenreport/kensho-cucumber-js/kensho';
//
//   Given('I am logged in', async function () {
//     kensho.Severity('critical');
//     kensho.JiraLink('PROJ-1');
//     await kensho.step('seed user', async () => { ... });
//   });

const SEVERITIES = ['blocker', 'critical', 'normal', 'minor', 'trivial'];

// Single active scenario scratch — cucumber runs scenarios serially per worker.
const scratch = {
  current: null,   // { behavior:{}, labels:{}, severity, owner, description,
                   //   tags:[], links:[], parameters:[], steps:[], stack:[],
                   //   flaky, muted }
};

function freshBuf() {
  return {
    behavior: {}, labels: {}, severity: undefined, owner: undefined,
    description: undefined, tags: [], links: [], parameters: [], steps: [],
    stack: [], flaky: false, muted: false,
  };
}

/** Formatter: begin a scenario scratch. Returns the buffer. */
export function _open() {
  scratch.current = freshBuf();
  return scratch.current;
}

/** Formatter: end the scenario scratch and hand back the accumulated buffer. */
export function _drain() {
  const buf = scratch.current;
  scratch.current = null;
  return buf;
}

function cleanTag(v) {
  return String(v == null ? '' : v).replace(/^@+/, '').trim();
}

function activeStepList() {
  const b = scratch.current;
  if (!b) return null;
  return b.stack.length ? b.stack[b.stack.length - 1].children : b.steps;
}

function shortId(prefix) {
  return prefix + '-' + Math.random().toString(36).slice(2, 10);
}

export const kensho = {
  // ---- structured metadata (BDD) ----
  Epic(v)    { if (scratch.current && v != null) setBehavior('epic', v); },
  Feature(v) { if (scratch.current && v != null) setBehavior('feature', v); },
  Story(v)   { if (scratch.current && v != null) setBehavior('scenario', v); },

  Severity(v) {
    if (!scratch.current) return;
    const s = String(v == null ? '' : v).toLowerCase();
    if (SEVERITIES.includes(s)) scratch.current.severity = s; // ignore unknown
  },
  Owner(v)       { if (scratch.current && v != null) scratch.current.owner = String(v); },
  Description(v) { if (scratch.current && v != null) scratch.current.description = String(v); },

  Tag(v) {
    if (!scratch.current) return;
    const t = cleanTag(v);
    if (t && !scratch.current.tags.includes(t)) scratch.current.tags.push(t);
  },
  Label(key, value) {
    if (!scratch.current || key == null) return;
    scratch.current.labels[String(key)] = String(value == null ? '' : value);
  },

  Link(url, name) {
    if (!scratch.current || !url) return;
    scratch.current.links.push({ url: String(url), label: name != null ? String(name) : undefined, kind: 'link' });
  },
  JiraLink(idOrUrl, name) {
    if (!scratch.current || !idOrUrl) return;
    const id = String(idOrUrl);
    scratch.current.links.push({ url: id, label: name != null ? String(name) : id, kind: 'issue' });
  },
  ReferenceLink(url, name) {
    if (!scratch.current || !url) return;
    scratch.current.links.push({ url: String(url), label: name != null ? String(name) : undefined, kind: 'reference' });
  },

  Parameter(name, value) {
    if (!scratch.current || name == null) return;
    scratch.current.parameters.push({ name: String(name), value: String(value == null ? '' : value) });
  },

  /**
   * Record a Kensho step. Appended AFTER the gherkin steps by the formatter.
   * Nests; on exception the step is marked fail and the error re-raised.
   */
  async step(name, fn) {
    if (!scratch.current) return typeof fn === 'function' ? await fn() : undefined;
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    const step = { id: shortId('step'), title: String(name == null ? 'step' : name), status: 'pass', startedAt, duration: 0, children: [] };
    const list = activeStepList();
    list.push(step);
    scratch.current.stack.push(step);
    try {
      const r = typeof fn === 'function' ? await fn() : undefined;
      step.status = 'pass';
      return r;
    } catch (e) {
      step.status = 'fail';
      step.assertion = { stack: e?.stack || String(e), received: String(e?.message || e) };
      throw e;
    } finally {
      step.duration = Math.max(0, Date.now() - t0);
      if (!step.children.length) delete step.children;
      scratch.current.stack.pop();
    }
  },

  // ---- runtime markers ----
  Flaky() { if (scratch.current) scratch.current.flaky = true; },
  Muted() { if (scratch.current) scratch.current.muted = true; },
  KnownIssue(idOrUrl, label) {
    if (!scratch.current) return;
    scratch.current.muted = true;
    if (idOrUrl != null) {
      const id = String(idOrUrl);
      scratch.current.links.push({ url: id, label: label != null ? String(label) : id, kind: 'issue' });
    }
  },
};

// lowercase aliases
kensho.epic = kensho.Epic;
kensho.feature = kensho.Feature;
kensho.story = kensho.Story;
kensho.severity = kensho.Severity;
kensho.owner = kensho.Owner;
kensho.description = kensho.Description;
kensho.tag = kensho.Tag;
kensho.label = kensho.Label;
kensho.link = kensho.Link;
kensho.jiraLink = kensho.JiraLink;
kensho.referenceLink = kensho.ReferenceLink;
kensho.parameter = kensho.Parameter;
kensho.flaky = kensho.Flaky;
kensho.muted = kensho.Muted;
kensho.knownIssue = kensho.KnownIssue;

function setBehavior(key, value) {
  const b = scratch.current;
  b.behavior[key] = String(value);
  const labelKey = key === 'scenario' ? 'story' : key;
  b.labels[labelKey] = String(value);
}

/**
 * Merge a drained scratch buffer into a Kensho case the formatter already
 * built from the message stream. Runtime/helper values win over derived ones.
 * Returns the same case object (mutated) for convenience.
 */
export function mergeCucumberMeta(caseObj, buf) {
  if (!caseObj || !buf) return caseObj;

  // behavior — formatter already sets {feature, scenario}; helper can add epic
  // and override.
  if (Object.keys(buf.behavior).length) {
    caseObj.behavior = { ...(caseObj.behavior || {}), ...buf.behavior };
  }

  // labels — mirror behavior + explicit labels.
  if (Object.keys(buf.labels).length) {
    caseObj.labels = { ...(caseObj.labels || {}), ...buf.labels };
  }

  if (buf.severity) caseObj.severity = buf.severity;       // runtime wins
  if (buf.owner) caseObj.owner = buf.owner;
  if (buf.description) caseObj.description = buf.description;

  if (buf.tags.length) {
    const set = new Set(caseObj.tags || []);
    for (const t of buf.tags) set.add(t);
    caseObj.tags = [...set];
  }

  if (buf.links.length) {
    caseObj.links = [...(caseObj.links || []), ...buf.links];
  }

  if (buf.parameters.length) {
    caseObj.parameters = [...(caseObj.parameters || []), ...buf.parameters];
  }

  // kensho.step entries are appended AFTER the gherkin steps.
  if (buf.steps.length) {
    caseObj.steps = [...(caseObj.steps || []), ...buf.steps];
  }

  if (buf.flaky) caseObj.flaky = true;
  if (buf.muted) caseObj.muted = true;

  return caseObj;
}
