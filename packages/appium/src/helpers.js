// Shared in-memory state for the helper API. Both the WDIO reporter and the
// generic Node hook funnel data through this so users get one consistent
// API regardless of which integration path they pick.
//
//   import { kensho } from '@kaizenreport/kensho-appium';
//   await kensho.step('Tap Login button', async () => { ... });
//   await kensho.attach('./screenshot.png', 'screenshot');
//   kensho.label('build', '4.12.3');
//   kensho.link('https://acme.atlassian.net/browse/MOB-12', 'jira', 'MOB-12');

import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, extname, resolve, relative } from 'node:path';
import { kindFor, mimeFor, shortId, nowIso } from './_schema.js';

const state = {
  // Per-test scratch — keyed by stable case id. The reporter sets the active
  // case id at test:start, and the helpers append into it.
  current: null,                    // { id, steps:[], attachments:[], labels:{}, links:[], stack:[] }
  byId: new Map(),                  // case id → buffer
  attachmentsRoot: null,            // set by the reporter
};

const SEVERITIES = ['blocker', 'critical', 'normal', 'minor', 'trivial'];

function freshBuf(id) {
  return {
    id,
    steps: [], attachments: [], labels: {}, links: [], stack: [],
    behavior: {}, parameters: [], tags: [],
    severity: undefined, owner: undefined, description: undefined,
    flaky: false, muted: false,
  };
}

export function _bind({ attachmentsRoot, currentId }) {
  state.attachmentsRoot = attachmentsRoot;
  if (currentId) {
    if (!state.byId.has(currentId)) {
      state.byId.set(currentId, freshBuf(currentId));
    }
    state.current = state.byId.get(currentId);
  } else {
    state.current = null;
  }
}

function cleanTag(v) {
  return String(v == null ? '' : v).replace(/^@+/, '').trim();
}

export function _drain(id) {
  const buf = state.byId.get(id);
  if (!buf) return null;
  state.byId.delete(id);
  return buf;
}

function activeFrame() {
  if (!state.current) return null;
  const stack = state.current.stack;
  return stack.length ? stack[stack.length - 1] : state.current;
}

export const kensho = {
  /**
   * Wrap a section of a test as a Kensho step. Nested calls produce sub-steps.
   * @template T
   * @param {string} name
   * @param {() => Promise<T> | T} fn
   * @returns {Promise<T>}
   */
  async step(name, fn) {
    if (!state.current) return await fn();
    const startedAt = nowIso();
    const startMs = Date.now();
    const step = {
      id: shortId('step'),
      title: name,
      status: 'pass',
      startedAt,
      duration: 0,
      children: [],
      attachments: [],
    };
    const parent = activeFrame();
    (parent.steps || parent.children).push(step);
    state.current.stack.push({ steps: step.children, attachments: step.attachments, _step: step });
    try {
      const out = await fn();
      step.duration = Math.max(0, Date.now() - startMs);
      return out;
    } catch (e) {
      step.status = 'fail';
      step.duration = Math.max(0, Date.now() - startMs);
      step.assertion = { stack: e?.stack, received: String(e?.message || e) };
      throw e;
    } finally {
      state.current.stack.pop();
      if (!step.children.length) delete step.children;
      if (!step.attachments.length) delete step.attachments;
    }
  },

  /**
   * Attach a file from disk to the current test (or current step if inside one).
   * `path` is copied into `kensho-results/attachments/<caseId>/`.
   */
  attach(path, kind) {
    if (!state.current || !state.attachmentsRoot) return;
    if (!existsSync(path)) return;
    const ext = extname(path).toLowerCase();
    const attId = shortId('att');
    const destDir = resolve(state.attachmentsRoot, state.current.id);
    mkdirSync(destDir, { recursive: true });
    const destPath = resolve(destDir, attId + '_' + basename(path));
    try { copyFileSync(path, destPath); } catch { return; }
    const sz = existsSync(destPath) ? statSync(destPath).size : 0;
    const att = {
      id: attId,
      kind: kind || kindFor(ext),
      relativePath: relative(resolve(state.attachmentsRoot, '..'), destPath),
      mimeType: mimeFor(ext),
      sizeBytes: sz,
    };
    const frame = activeFrame();
    if (frame === state.current) state.current.attachments.push(att);
    else frame.attachments.push(att);
  },

  /** Add a free-form label, e.g. `kensho.label('build', '4.12.3')`. */
  label(key, value) {
    if (!state.current) return;
    if (key && value != null) state.current.labels[String(key)] = String(value);
  },

  /** Add a link, e.g. `kensho.link('https://...','jira','MOB-12')`. */
  link(url, kind, label) {
    if (!state.current || !url) return;
    state.current.links.push({ url: String(url), kind: kind || 'link', label });
  },

  // ---- structured metadata (BDD) ----
  Epic(v)    { setBehavior('epic', v); },
  Feature(v) { setBehavior('feature', v); },
  Story(v)   { setBehavior('scenario', v); },

  Severity(v) {
    if (!state.current) return;
    const s = String(v == null ? '' : v).toLowerCase();
    if (SEVERITIES.includes(s)) state.current.severity = s; // ignore unknown
  },
  Owner(v)       { if (state.current && v != null) state.current.owner = String(v); },
  Description(v) { if (state.current && v != null) state.current.description = String(v); },

  Tag(v) {
    if (!state.current) return;
    const t = cleanTag(v);
    if (t && !state.current.tags.includes(t)) state.current.tags.push(t);
  },
  Label(key, value) { this.label(key, value); },

  Link(url, name)     { this.link(url, 'link', name); },
  JiraLink(idOrUrl, name) {
    if (!state.current || !idOrUrl) return;
    const id = String(idOrUrl);
    this.link(id, 'issue', name != null ? String(name) : id);
  },
  ReferenceLink(url, name) { this.link(url, 'reference', name); },

  Parameter(name, value) {
    if (!state.current || name == null) return;
    state.current.parameters.push({ name: String(name), value: String(value == null ? '' : value) });
  },

  // ---- runtime markers ----
  Flaky() { if (state.current) state.current.flaky = true; },
  Muted() { if (state.current) state.current.muted = true; },
  KnownIssue(idOrUrl, label) {
    if (!state.current) return;
    state.current.muted = true;
    if (idOrUrl != null) {
      const id = String(idOrUrl);
      this.link(id, 'issue', label != null ? String(label) : id);
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
kensho.jiraLink = kensho.JiraLink;
kensho.referenceLink = kensho.ReferenceLink;
kensho.parameter = kensho.Parameter;
kensho.flaky = kensho.Flaky;
kensho.muted = kensho.Muted;
kensho.knownIssue = kensho.KnownIssue;

function setBehavior(key, value) {
  if (!state.current || value == null) return;
  state.current.behavior[key] = String(value);
  const labelKey = key === 'scenario' ? 'story' : key;
  state.current.labels[labelKey] = String(value);
}

/**
 * Fold a drained helper buffer into a Kensho case the reporter/session built.
 * Runtime/helper values win over derived ones. Mutates and returns caseObj.
 *
 *   import { mergeAppiumMeta } from '.../helpers.js';
 *   mergeAppiumMeta(caseObj, buf);
 */
export function mergeAppiumMeta(caseObj, buf) {
  if (!caseObj || !buf) return caseObj;

  if (buf.behavior && Object.keys(buf.behavior).length) {
    caseObj.behavior = { ...(caseObj.behavior || {}), ...buf.behavior };
  }
  if (buf.severity) caseObj.severity = buf.severity;     // runtime wins
  if (buf.owner) caseObj.owner = buf.owner;
  if (buf.description) caseObj.description = buf.description;

  if (buf.tags && buf.tags.length) {
    const set = new Set(caseObj.tags || []);
    for (const t of buf.tags) set.add(t);
    caseObj.tags = [...set];
  }
  if (buf.parameters && buf.parameters.length) {
    caseObj.parameters = [...(caseObj.parameters || []), ...buf.parameters];
  }
  if (buf.flaky) caseObj.flaky = true;
  if (buf.muted) caseObj.muted = true;

  return caseObj;
}
