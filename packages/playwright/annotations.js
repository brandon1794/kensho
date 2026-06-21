// @kaizenreport/kensho-playwright/annotations — the full Kensho annotation API
// for Playwright tests, plus the reader the reporter uses to fold those
// annotations into a Kensho case.
//
// Playwright tests run in a different process than the reporter, so the only
// channel they share is `test.info().annotations` ({ type, description }).
// The `kensho` helper writes structured entries onto that array (encoding
// non-string payloads as JSON) and the reporter calls
// `parseKenshoAnnotations(annotations)` at case-build time to decode them.
//
//   import { test } from '@playwright/test';
//   import { kensho } from '@kaizenreport/kensho-playwright/annotations';
//
//   test('login', async ({ page }) => {
//     kensho.Feature('Auth'); kensho.Severity('critical'); kensho.Owner('ana');
//     kensho.Tag('smoke'); kensho.Link('https://runbook', 'Runbook');
//     await kensho.step('open page', async () => { ... });
//   });

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const SEVERITIES = ['blocker', 'critical', 'normal', 'minor', 'trivial'];

// Reserved annotation types Kensho understands. Anything written through the
// helper uses one of these so plain user annotations (e.g. test.info()
// .annotations.push({ type: 'issue', ... })) don't collide with our schema.
const T = {
  behavior: 'kensho:behavior',   // description = JSON { epic?, feature?, scenario? }
  label: 'kensho:label',         // description = JSON { key, value }
  severity: 'kensho:severity',   // description = severity string
  owner: 'kensho:owner',         // description = owner string
  description: 'kensho:description',
  tag: 'kensho:tag',             // description = tag string (no leading @)
  link: 'kensho:link',           // description = JSON { url, label?, kind? }
  parameter: 'kensho:param',     // description = JSON { name, value }
  step: 'kensho:step',           // description = JSON { title, status, duration }
  flaky: 'kensho:flaky',
  muted: 'kensho:muted',
};

function annotations() {
  // Lazy require so importing this module never pulls @playwright/test when
  // the helper is used in an environment that doesn't have an active test.
  try {
    // eslint-disable-next-line global-require
    const pw = require('@playwright/test');
    const info = pw.test?.info?.();
    return info?.annotations || null;
  } catch {
    return null;
  }
}

function push(type, description) {
  const arr = annotations();
  if (!arr) return; // no-op outside an active test
  arr.push(description === undefined ? { type } : { type, description: String(description) });
}

function pushJson(type, obj) {
  push(type, JSON.stringify(obj));
}

function cleanTag(v) {
  return String(v == null ? '' : v).replace(/^@+/, '').trim();
}

export const kensho = {
  // ---- structured metadata (BDD) ----
  Epic(v)    { if (v != null) pushJson(T.behavior, { epic: String(v) }); },
  Feature(v) { if (v != null) pushJson(T.behavior, { feature: String(v) }); },
  Story(v)   { if (v != null) pushJson(T.behavior, { scenario: String(v) }); },

  Severity(v) {
    const s = String(v == null ? '' : v).toLowerCase();
    if (SEVERITIES.includes(s)) push(T.severity, s); // ignore unknown
  },
  Owner(v)       { if (v != null) push(T.owner, String(v)); },
  Description(v) { if (v != null) push(T.description, String(v)); },

  Tag(v) { const t = cleanTag(v); if (t) push(T.tag, t); },
  Label(key, value) {
    if (key == null) return;
    pushJson(T.label, { key: String(key), value: String(value == null ? '' : value) });
  },

  Link(url, name) {
    if (!url) return;
    pushJson(T.link, { url: String(url), label: name != null ? String(name) : undefined, kind: 'link' });
  },
  JiraLink(idOrUrl, name) {
    if (!idOrUrl) return;
    const id = String(idOrUrl);
    pushJson(T.link, { url: id, label: name != null ? String(name) : id, kind: 'issue' });
  },
  ReferenceLink(url, name) {
    if (!url) return;
    pushJson(T.link, { url: String(url), label: name != null ? String(name) : undefined, kind: 'reference' });
  },

  Parameter(name, value) {
    if (name == null) return;
    pushJson(T.parameter, { name: String(name), value: String(value == null ? '' : value) });
  },

  // ---- runtime markers ----
  Flaky() { push(T.flaky); },
  Muted() { push(T.muted); },
  KnownIssue(idOrUrl, label) {
    push(T.muted);
    if (idOrUrl != null) {
      const id = String(idOrUrl);
      pushJson(T.link, { url: id, label: label != null ? String(label) : id, kind: 'issue' });
    }
  },

  /**
   * Record a Kensho step. Delegates to Playwright's native `test.step` so the
   * step shows up in traces too; the reporter already maps native steps, so we
   * also stash a marker annotation in case the native step tree is unavailable.
   */
  async step(name, fn) {
    const title = String(name == null ? 'step' : name);
    let pw;
    try { pw = require('@playwright/test'); } catch { pw = null; }
    const native = pw?.test?.step;
    // Only delegate to native test.step when there's an active test (it throws
    // otherwise). `test.info()` resolving to annotations is our liveness probe.
    if (typeof native === 'function' && annotations()) {
      // Native test.step records timing + nesting itself.
      return await native.call(pw.test, title, async () => {
        return typeof fn === 'function' ? await fn() : undefined;
      });
    }
    // No active Playwright test — run the body but don't record (no-op marker).
    return typeof fn === 'function' ? await fn() : undefined;
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

function tryParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * Decode Kensho annotations into a partial-case patch the reporter merges in.
 * Pure function — safe to unit-test directly.
 *
 * @param {Array<{type:string, description?:string}>} annotations
 * @returns {{
 *   behavior?: { epic?: string, feature?: string, scenario?: string },
 *   labels?: Record<string,string>,
 *   severity?: string,
 *   owner?: string,
 *   description?: string,
 *   tags: string[],
 *   links: Array<{url:string, label?:string, kind?:string}>,
 *   parameters: Array<{name:string, value:string}>,
 *   steps: Array<{title:string, status:string, duration:number}>,
 *   flaky?: boolean,
 *   muted?: boolean,
 * }}
 */
export function parseKenshoAnnotations(annotations) {
  const out = {
    behavior: undefined,
    labels: undefined,
    severity: undefined,
    owner: undefined,
    description: undefined,
    tags: [],
    links: [],
    parameters: [],
    steps: [],
    flaky: undefined,
    muted: undefined,
  };
  const behavior = {};
  const labels = {};
  for (const a of annotations || []) {
    if (!a || !a.type) continue;
    switch (a.type) {
      case T.behavior: {
        const o = tryParse(a.description);
        if (o && typeof o === 'object') {
          if (o.epic != null) behavior.epic = String(o.epic);
          if (o.feature != null) behavior.feature = String(o.feature);
          if (o.scenario != null) behavior.scenario = String(o.scenario);
        }
        break;
      }
      case T.label: {
        const o = tryParse(a.description);
        if (o && o.key != null) labels[String(o.key)] = String(o.value == null ? '' : o.value);
        break;
      }
      case T.severity:
        if (SEVERITIES.includes(String(a.description))) out.severity = String(a.description);
        break;
      case T.owner:
        if (a.description) out.owner = String(a.description);
        break;
      case T.description:
        if (a.description) out.description = String(a.description);
        break;
      case T.tag: {
        const t = cleanTag(a.description);
        if (t && !out.tags.includes(t)) out.tags.push(t);
        break;
      }
      case T.link: {
        const o = tryParse(a.description);
        if (o && o.url) out.links.push({ url: String(o.url), label: o.label != null ? String(o.label) : undefined, kind: o.kind || 'link' });
        break;
      }
      case T.parameter: {
        const o = tryParse(a.description);
        if (o && o.name != null) out.parameters.push({ name: String(o.name), value: String(o.value == null ? '' : o.value) });
        break;
      }
      case T.step: {
        const o = tryParse(a.description);
        if (o && o.title != null) {
          out.steps.push({
            title: String(o.title),
            status: ['pass', 'fail', 'skip'].includes(o.status) ? o.status : 'pass',
            duration: Number.isFinite(o.duration) ? Math.max(0, Math.round(o.duration)) : 0,
          });
        }
        break;
      }
      case T.flaky:
        out.flaky = true;
        break;
      case T.muted:
        out.muted = true;
        break;
      default:
        break;
    }
  }
  if (Object.keys(behavior).length) out.behavior = behavior;
  if (Object.keys(labels).length) out.labels = labels;
  return out;
}

// Re-exported reserved annotation types so the reporter can filter them out of
// the generic "labels from annotations" pass.
export const KENSHO_ANNOTATION_TYPES = new Set(Object.values(T));
