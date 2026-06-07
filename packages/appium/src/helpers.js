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

export function _bind({ attachmentsRoot, currentId }) {
  state.attachmentsRoot = attachmentsRoot;
  if (currentId) {
    if (!state.byId.has(currentId)) {
      state.byId.set(currentId, { id: currentId, steps: [], attachments: [], labels: {}, links: [], stack: [] });
    }
    state.current = state.byId.get(currentId);
  } else {
    state.current = null;
  }
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
    state.current.links.push({ url: String(url), kind, label });
  },
};
