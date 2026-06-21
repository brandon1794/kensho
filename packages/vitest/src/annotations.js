// @kaizenreport/kensho-vitest — the `kensho` annotation + runtime-marker API.
//
// Vitest runs tests in worker processes, so the metadata a test records can't
// be handed to the reporter in-memory. Instead each `kensho.*` call buffers
// into a per-test record and flushes it to a sidecar JSON file under
// <output>/.annotations/<key>.json, keyed by sha1(normalizedFullName).slice(0,16).
// The reporter (parent process) reads the sidecar and merges it into the case.
//
// "Current test" is resolved via getCurrentTest() from 'vitest/suite'. All
// calls are no-ops outside an active test.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const SEVERITIES = ['blocker', 'critical', 'normal', 'minor', 'trivial'];

/** Sidecar directory. Mirrors the reporter's `output` option (default kensho-results). */
export function annotationsDirFor(outputDir) {
  return resolve(outputDir || resolve(process.cwd(), process.env.KENSHO_OUTPUT || 'kensho-results'), '.annotations');
}

/** Collapse Kensho/Vitest suite separators so both sides hash to the same key. */
export function normalizeFullName(fullName) {
  return String(fullName || '')
    .replace(/\s*[›>]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function keyFor(fullName) {
  return createHash('sha1').update(normalizeFullName(fullName)).digest('hex').slice(0, 16);
}

// ── current-test resolution (worker side) ──────────────────────────────────
let _resolver = undefined; // undefined = not tried, null = unavailable, fn = ready

/** Inject a getCurrentTest resolver (tests + lazy vitest/suite wiring). */
export function _setCurrentTestResolver(fn) {
  _resolver = typeof fn === 'function' ? fn : null;
}

function resolveCurrentTest() {
  if (_resolver === undefined) {
    // Prefer an injected global (set by tests or by the package entry once it
    // has loaded vitest/suite). We don't statically import 'vitest/suite' here
    // to keep this module loadable outside a vitest worker.
    const g = globalThis.__kensho_getCurrentTest__;
    _resolver = typeof g === 'function' ? g : null;
  }
  if (typeof _resolver !== 'function') return null;
  try { return _resolver() || null; } catch { return null; }
}

function taskFullName(task) {
  if (!task) return null;
  if (task.fullName) return task.fullName;
  const chain = [];
  let s = task.suite || task.parent;
  while (s && s.name != null) { chain.unshift(s.name); s = s.suite || s.parent; }
  if (task.name) chain.push(task.name);
  return chain.join(' ');
}

// ── per-test buffer ─────────────────────────────────────────────────────────
const buffers = new Map();

function record() {
  const task = resolveCurrentTest();
  if (!task) return null;
  const fullName = taskFullName(task);
  if (!fullName) return null;
  const key = keyFor(fullName);
  let rec = buffers.get(key);
  if (!rec) {
    rec = { fullName, behavior: {}, labels: {}, tags: [], links: [], parameters: [], steps: [], _stepStack: [] };
    buffers.set(key, rec);
  }
  return rec;
}

function flush(rec) {
  if (!rec) return;
  try {
    const dir = annotationsDirFor();
    mkdirSync(dir, { recursive: true });
    const { _stepStack, ...persist } = rec;
    writeFileSync(resolve(dir, keyFor(rec.fullName) + '.json'), JSON.stringify(persist));
  } catch { /* best-effort */ }
}

function addLink(rec, url, label, kind) {
  if (!url) return;
  rec.links.push({ url: String(url), label: label != null ? String(label) : undefined, kind });
}

function activeSteps(rec) {
  const stack = rec._stepStack;
  return stack.length ? stack[stack.length - 1].children : rec.steps;
}

// ── the public API ──────────────────────────────────────────────────────────
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
  async step(name, fn) {
    const r = record();
    if (!r) return typeof fn === 'function' ? await fn() : undefined;
    const startMs = Date.now();
    const step = { id: 'step-' + Math.random().toString(36).slice(2, 10), title: String(name), status: 'pass', startedAt: new Date(startMs).toISOString(), duration: 0, children: [] };
    activeSteps(r).push(step);
    r._stepStack.push(step);
    try {
      const out = typeof fn === 'function' ? await fn() : undefined;
      step.duration = Math.max(0, Date.now() - startMs);
      return out;
    } catch (e) {
      step.status = 'fail';
      step.duration = Math.max(0, Date.now() - startMs);
      throw e;
    } finally {
      r._stepStack.pop();
      if (!step.children.length) delete step.children;
      flush(r);
    }
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

// lowercase aliases
api.epic = api.Epic; api.feature = api.Feature; api.story = api.Story;
api.severity = api.Severity; api.owner = api.Owner; api.description = api.Description;
api.tag = api.Tag; api.label = api.Label; api.link = api.Link;
api.jiraLink = api.JiraLink; api.referenceLink = api.ReferenceLink; api.parameter = api.Parameter;
api.flaky = api.Flaky; api.muted = api.Muted; api.knownIssue = api.KnownIssue;

export const kensho = api;

/**
 * Merge a sidecar record into a case object (reporter side). Runtime values
 * win over tag/attribute-derived metadata already on the case.
 */
export function mergeAnnotations(caseObj, rec) {
  if (!rec) return caseObj;
  if (rec.behavior && Object.keys(rec.behavior).length) {
    caseObj.behavior = { ...(caseObj.behavior || {}), ...rec.behavior };
  }
  if (rec.labels && Object.keys(rec.labels).length) {
    caseObj.labels = { ...(caseObj.labels || {}), ...rec.labels };
  }
  if (rec.severity) caseObj.severity = rec.severity;
  if (rec.owner) caseObj.owner = rec.owner;
  if (rec.description) caseObj.description = rec.description;
  if (Array.isArray(rec.tags) && rec.tags.length) {
    caseObj.tags = [...new Set([...(caseObj.tags || []), ...rec.tags])];
  }
  if (Array.isArray(rec.parameters) && rec.parameters.length) {
    caseObj.parameters = [...(caseObj.parameters || []), ...rec.parameters];
  }
  if (Array.isArray(rec.links) && rec.links.length) {
    caseObj.links = [...(caseObj.links || []), ...rec.links];
  }
  if (Array.isArray(rec.steps) && rec.steps.length) {
    caseObj.steps = [...(caseObj.steps || []), ...rec.steps];
  }
  if (rec.flaky) caseObj.flaky = true;
  if (rec.muted) caseObj.muted = true;
  return caseObj;
}

/** Read a sidecar for a case fullName, if present (reporter side). */
export function readAnnotations(outputDir, fullName) {
  try {
    const file = resolve(annotationsDirFor(outputDir), keyFor(fullName) + '.json');
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch { return null; }
}
