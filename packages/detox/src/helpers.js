// Helper API mirroring kensho-appium's. Buffers per-case data in-process; the
// Jest reporter drains it on `onTestResult`.

import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, extname, resolve, relative } from 'node:path';

const state = {
  current: null,
  byKey: new Map(),       // key (fullName) → buffer
  attachmentsRoot: null,
  outputDir: null,
};

function shortId(prefix) { return prefix + '-' + Math.random().toString(36).slice(2, 10); }
function nowIso() { return new Date().toISOString(); }

const KIND_BY_EXT = {
  '.png': 'screenshot', '.jpg': 'screenshot', '.jpeg': 'screenshot', '.webp': 'screenshot',
  '.mp4': 'video', '.mov': 'video', '.webm': 'video',
  '.txt': 'text', '.log': 'log', '.json': 'json',
};
const MIME_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.txt': 'text/plain', '.log': 'text/plain', '.json': 'application/json',
};

export function _bind({ outputDir, attachmentsRoot, key }) {
  state.outputDir = outputDir;
  state.attachmentsRoot = attachmentsRoot;
  if (key) {
    if (!state.byKey.has(key)) state.byKey.set(key, { steps: [], attachments: [], labels: {}, links: [], stack: [] });
    state.current = state.byKey.get(key);
    state.current._key = key;
  } else {
    state.current = null;
  }
}

export function _drain(key) {
  const buf = state.byKey.get(key);
  if (buf) state.byKey.delete(key);
  return buf;
}

function activeFrame() {
  if (!state.current) return null;
  const stack = state.current.stack;
  return stack.length ? stack[stack.length - 1] : state.current;
}

export const kensho = {
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

  attach(path, kind) {
    if (!state.current || !state.attachmentsRoot) return;
    if (!existsSync(path)) return;
    const ext = extname(path).toLowerCase();
    const attId = shortId('att');
    const safeKey = String(state.current._key || 'case').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 64);
    const destDir = resolve(state.attachmentsRoot, safeKey);
    mkdirSync(destDir, { recursive: true });
    const destPath = resolve(destDir, attId + '_' + basename(path));
    try { copyFileSync(path, destPath); } catch { return; }
    const sz = existsSync(destPath) ? statSync(destPath).size : 0;
    const att = {
      id: attId,
      kind: kind || KIND_BY_EXT[ext] || 'text',
      relativePath: relative(state.outputDir || resolve(state.attachmentsRoot, '..'), destPath),
      mimeType: MIME_BY_EXT[ext] || 'application/octet-stream',
      sizeBytes: sz,
    };
    const frame = activeFrame();
    if (frame === state.current) state.current.attachments.push(att);
    else frame.attachments.push(att);
  },

  label(key, value) {
    if (!state.current) return;
    if (key && value != null) state.current.labels[String(key)] = String(value);
  },

  link(url, kind, label) {
    if (!state.current || !url) return;
    state.current.links.push({ url: String(url), kind, label });
  },
};
