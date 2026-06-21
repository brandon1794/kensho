// @kaizenreport/kensho-cypress — browser-side `kensho` annotation + runtime-marker API.
//
// Cypress tests run in the browser, which has no filesystem. Each `kensho.*`
// call accumulates into a per-test record and ships it to the Node process via
// `cy.task('kensho:annotations', record)`. The Node task (./task.js) writes a
// sidecar JSON file under <output>/.annotations/<key>.json; the Mocha reporter
// (index.js) reads it back and merges it into the case.
//
// The "current test" is resolved from Cypress.currentTest.titlePath. All calls
// are no-ops outside an active test (or outside Cypress entirely).

const SEVERITIES = ['blocker', 'critical', 'normal', 'minor', 'trivial'];

function cy_() { return typeof cy !== 'undefined' ? cy : null; }
function Cypress_() { return typeof Cypress !== 'undefined' ? Cypress : null; }

function currentFullName() {
  const C = Cypress_();
  if (!C || !C.currentTest) return null;
  const path = C.currentTest.titlePath;
  if (Array.isArray(path) && path.length) return path.join(' ');
  return C.currentTest.title || null;
}

// Per-test buffer, reset when the test changes.
let buffer = null;
let bufferFor = null;

function record() {
  const fullName = currentFullName();
  if (!fullName) return null;
  if (bufferFor !== fullName) {
    buffer = { fullName, behavior: {}, labels: {}, tags: [], links: [], parameters: [], steps: [], _stepStack: [] };
    bufferFor = fullName;
  }
  return buffer;
}

function flush(rec) {
  if (!rec) return;
  const cy = cy_();
  if (!cy || typeof cy.task !== 'function') return;
  const { _stepStack, ...persist } = rec;
  try {
    // fire-and-forget; { log:false } keeps the command log clean.
    cy.task('kensho:annotations', persist, { log: false });
  } catch { /* not inside a runnable */ }
}

function addLink(rec, url, label, kind) {
  if (!url) return;
  rec.links.push({ url: String(url), label: label != null ? String(label) : undefined, kind });
}

function activeSteps(rec) {
  const stack = rec._stepStack;
  return stack.length ? stack[stack.length - 1].children : rec.steps;
}

const api = {
  Epic(v) { const r = record(); if (!r || v == null) return; r.behavior.epic = String(v); r.labels.epic = String(v); flush(r); },
  Feature(v) { const r = record(); if (!r || v == null) return; r.behavior.feature = String(v); r.labels.feature = String(v); flush(r); },
  Story(v) { const r = record(); if (!r || v == null) return; r.behavior.scenario = String(v); r.labels.story = String(v); flush(r); },
  Severity(v) {
    const r = record(); if (!r || v == null) return;
    const s = String(v).toLowerCase();
    if (SEVERITIES.includes(s)) { r.severity = s; flush(r); }
  },
  Owner(v) { const r = record(); if (!r || v == null) return; r.owner = String(v); flush(r); },
  Description(v) { const r = record(); if (!r || v == null) return; r.description = String(v); flush(r); },
  Tag(v) {
    const r = record(); if (!r || v == null) return;
    const t = String(v).replace(/^@/, '');
    if (t && !r.tags.includes(t)) r.tags.push(t);
    flush(r);
  },
  Label(k, v) { const r = record(); if (!r || k == null || v == null) return; r.labels[String(k)] = String(v); flush(r); },
  Link(url, name) { const r = record(); if (!r) return; addLink(r, url, name, 'link'); flush(r); },
  JiraLink(idOrUrl, name) { const r = record(); if (!r || idOrUrl == null) return; addLink(r, idOrUrl, name != null ? name : idOrUrl, 'issue'); flush(r); },
  ReferenceLink(url, name) { const r = record(); if (!r) return; addLink(r, url, name, 'reference'); flush(r); },
  Parameter(name, value) {
    const r = record(); if (!r || name == null) return;
    r.parameters.push({ name: String(name), value: value == null ? '' : (typeof value === 'object' ? JSON.stringify(value) : String(value)) });
    flush(r);
  },
  step(name, fn) {
    const r = record();
    if (!r) return typeof fn === 'function' ? fn() : undefined;
    const startMs = Date.now();
    const step = { id: 'step-' + Math.random().toString(36).slice(2, 10), title: String(name), status: 'pass', startedAt: new Date(startMs).toISOString(), duration: 0, children: [] };
    activeSteps(r).push(step);
    r._stepStack.push(step);
    let out;
    try {
      out = typeof fn === 'function' ? fn() : undefined;
      step.duration = Math.max(0, Date.now() - startMs);
    } catch (e) {
      step.status = 'fail';
      step.duration = Math.max(0, Date.now() - startMs);
      r._stepStack.pop();
      if (!step.children.length) delete step.children;
      flush(r);
      throw e;
    }
    r._stepStack.pop();
    if (!step.children.length) delete step.children;
    flush(r);
    return out;
  },
  // ── runtime markers ──
  Flaky() { const r = record(); if (!r) return; r.flaky = true; flush(r); },
  Muted() { const r = record(); if (!r) return; r.muted = true; flush(r); },
  KnownIssue(idOrUrl, label) {
    const r = record(); if (!r || idOrUrl == null) return;
    r.muted = true;
    addLink(r, idOrUrl, label != null ? label : idOrUrl, 'issue');
    flush(r);
  },
};

api.epic = api.Epic; api.feature = api.Feature; api.story = api.Story;
api.severity = api.Severity; api.owner = api.Owner; api.description = api.Description;
api.tag = api.Tag; api.label = api.Label; api.link = api.Link;
api.jiraLink = api.JiraLink; api.referenceLink = api.ReferenceLink; api.parameter = api.Parameter;
api.flaky = api.Flaky; api.muted = api.Muted; api.knownIssue = api.KnownIssue;

export const kensho = api;
export default kensho;
