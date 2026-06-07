// @kaizenreport/kensho-jasmine — Jasmine reporter that writes Kensho v1
// results. Implements the subset of the Jasmine Reporter interface we need:
// jasmineStarted, suiteStarted, specStarted, specDone, suiteDone, jasmineDone.
//
// Also exports a small `kensho` helper (step / attach / label / link) that
// matches the @kaizenreport/kensho-jest API so test code can be portable.

import {
  mkdirSync,
  writeFileSync,
  copyFileSync,
  statSync,
  existsSync,
} from 'node:fs';
import { resolve, basename, extname } from 'node:path';
import {
  emptyRun,
  computeTotals,
  stableCaseId,
  validateRun,
  envInfo,
} from '@kaizenreport/kensho-schema';

const MIME_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.webm': 'video/webm', '.mp4': 'video/mp4',
  '.zip': 'application/zip', '.html': 'text/html',
  '.json': 'application/json', '.txt': 'text/plain', '.log': 'text/plain',
  '.har': 'application/json',
};
const KIND_BY_EXT = {
  '.png': 'screenshot', '.jpg': 'screenshot', '.jpeg': 'screenshot', '.webp': 'screenshot',
  '.webm': 'video', '.mp4': 'video',
  '.zip': 'trace',
  '.html': 'html', '.json': 'json', '.txt': 'text', '.log': 'log',
  '.har': 'har',
};

// envInfo() is imported from @kaizenreport/kensho-schema below.

function mapStatus(jasmineStatus) {
  // Jasmine spec statuses: 'passed' | 'failed' | 'pending' | 'excluded' | 'todo'
  if (jasmineStatus === 'passed') return 'pass';
  if (jasmineStatus === 'failed') return 'fail';
  if (jasmineStatus === 'pending' || jasmineStatus === 'excluded' || jasmineStatus === 'todo') return 'skip';
  return 'broken';
}

function extractInlineTags(title) {
  const tags = [];
  const re = /@([\w-]+)/g;
  let m;
  while ((m = re.exec(title || ''))) tags.push(m[1]);
  return tags;
}

function severityFromTags(tags) {
  for (const t of tags || []) {
    const m = /^@?(blocker|critical|normal|minor|trivial)$/i.exec(t);
    if (m) return m[1].toLowerCase();
  }
  return undefined;
}

function severityFromPendingReason(reason) {
  if (!reason || typeof reason !== 'string') return undefined;
  const m = /(blocker|critical|normal|minor|trivial)/i.exec(reason);
  return m ? m[1].toLowerCase() : undefined;
}

function shortId(prefix) {
  return prefix + '-' + Math.random().toString(36).slice(2, 10);
}

// In-flight context shared with the helper API. The reporter pushes/pops
// onto this so kensho.step / attach / label / link know which case they're
// attaching to.
const ctx = {
  current: null,        // { caseObj, stepStack: [] }
  consoleHooked: false,
  origConsole: null,
  reporters: new Set(),
};

function attachConsoleCapture() {
  if (ctx.consoleHooked) return;
  ctx.consoleHooked = true;
  ctx.origConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug ? console.debug.bind(console) : console.log.bind(console),
  };
  const make = (level) => (...args) => {
    if (ctx.current?.caseObj) {
      const c = ctx.current.caseObj;
      const t0 = Date.parse(c.startedAt) || Date.now();
      c.logs = c.logs || [];
      c.logs.push({
        t: Math.max(0, Date.now() - t0),
        level,
        msg: args.map(a => (typeof a === 'string' ? a : safeStringify(a))).join(' '),
      });
    }
    ctx.origConsole[level === 'debug' ? 'debug' : level](...args);
  };
  console.log = make('info');
  console.info = make('info');
  console.warn = make('warn');
  console.error = make('error');
  console.debug = make('debug');
}

function safeStringify(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}

// ---------------- Helper API ----------------

export const kensho = {
  /**
   * Wrap a section of the test as a Kensho step. The fn can be sync or async.
   * On exception the step is marked 'fail' and the error re-thrown.
   */
  async step(title, fn) {
    if (!ctx.current) {
      // outside of a spec — execute, but don't record
      return await (typeof fn === 'function' ? fn() : undefined);
    }
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    const step = {
      id: shortId('step'),
      title: String(title || 'step'),
      status: 'pass',
      startedAt,
      duration: 0,
      children: [],
    };
    const parent = ctx.current.stepStack.length
      ? ctx.current.stepStack[ctx.current.stepStack.length - 1]
      : null;
    if (parent) (parent.children = parent.children || []).push(step);
    else (ctx.current.caseObj.steps = ctx.current.caseObj.steps || []).push(step);
    ctx.current.stepStack.push(step);
    try {
      const r = typeof fn === 'function' ? await fn() : undefined;
      step.status = 'pass';
      return r;
    } catch (e) {
      step.status = 'fail';
      step.assertion = {
        expected: undefined,
        received: undefined,
        diff: undefined,
        stack: e?.stack || String(e),
      };
      throw e;
    } finally {
      step.duration = Math.max(0, Date.now() - t0);
      ctx.current.stepStack.pop();
    }
  },

  /**
   * Attach a file (path) to the current case (or current step if one is open).
   * The file is copied into kensho-results/attachments/<caseId>/.
   */
  attach(filePath, opts = {}) {
    if (!ctx.current) return;
    const reporter = [...ctx.reporters][0];
    if (!reporter) return;
    if (!existsSync(filePath)) return;
    const ext = extname(filePath).toLowerCase();
    const id = shortId('att');
    const destDir = resolve(reporter.attachmentsDir, ctx.current.caseObj.id);
    mkdirSync(destDir, { recursive: true });
    const destName = id + '_' + (opts.name ? safeName(opts.name) : basename(filePath));
    const destPath = resolve(destDir, destName);
    try { copyFileSync(filePath, destPath); } catch { return; }
    const stat = existsSync(destPath) ? statSync(destPath) : { size: 0 };
    const attachment = {
      id,
      kind: opts.kind || KIND_BY_EXT[ext] || 'text',
      relativePath: 'attachments/' + ctx.current.caseObj.id + '/' + destName,
      mimeType: opts.mimeType || MIME_BY_EXT[ext] || 'application/octet-stream',
      sizeBytes: stat.size,
    };
    const tip = ctx.current.stepStack[ctx.current.stepStack.length - 1];
    if (tip) (tip.attachments = tip.attachments || []).push(attachment);
    else (ctx.current.caseObj.attachments = ctx.current.caseObj.attachments || []).push(attachment);
    return attachment;
  },

  /** Adds a string label to the current case. */
  label(key, value) {
    if (!ctx.current || !key) return;
    const c = ctx.current.caseObj;
    c.labels = c.labels || {};
    c.labels[String(key)] = String(value);
  },

  /** Adds a hyperlink to the current case. */
  link(url, opts = {}) {
    if (!ctx.current || !url) return;
    const c = ctx.current.caseObj;
    c.links = c.links || [];
    c.links.push({
      url: String(url),
      kind: opts.kind,
      label: opts.label,
    });
  },
};

function safeName(s) {
  return String(s).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
}

// ---------------- Reporter ----------------

export default class KenshoJasmineReporter {
  /**
   * @param {{
   *   output?: string,
   *   project?: { name?: string, slug?: string, url?: string },
   *   severityFromTag?: boolean,
   *   runId?: string,
   *   filePath?: string,
   * }} [opts]
   */
  constructor(opts = {}) {
    this.outputDir = resolve(process.cwd(), opts.output || 'kensho-results');
    this.casesDir = resolve(this.outputDir, 'cases');
    this.attachmentsDir = resolve(this.outputDir, 'attachments');
    this.project = opts.project || {};
    this.severityFromTag = opts.severityFromTag !== false;
    this.runId = opts.runId || ('run_' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14));
    this.defaultFilePath = opts.filePath;
    this.startedAt = new Date().toISOString();
    this.casesById = new Map();
    this.suiteStack = [];

    mkdirSync(this.outputDir, { recursive: true });
    mkdirSync(this.casesDir, { recursive: true });
    mkdirSync(this.attachmentsDir, { recursive: true });

    ctx.reporters.add(this);
    attachConsoleCapture();
  }

  jasmineStarted() {
    this.startedAt = new Date().toISOString();
  }

  suiteStarted(result) {
    this.suiteStack.push(result?.description || '');
  }

  suiteDone() {
    this.suiteStack.pop();
  }

  specStarted(result) {
    const suite = this.suiteStack.filter(Boolean).slice();
    const name = result?.description || 'unnamed';
    const fullName = result?.fullName || suite.concat(name).join(' ');
    const filePath = result?.filename
      ? safePath(result.filename)
      : this.defaultFilePath;
    let id = stableCaseId(fullName, filePath);
    if (this.casesById.has(id)) {
      let i = 2;
      while (this.casesById.has(id + '_' + i)) i++;
      id = id + '_' + i;
    }
    const tags = extractInlineTags(name);
    const startedAt = new Date().toISOString();
    const caseObj = {
      id,
      name,
      fullName,
      filePath,
      suite,
      tags,
      severity: this.severityFromTag ? severityFromTags(tags) : undefined,
      status: 'pass',
      startedAt,
      finishedAt: startedAt,
      duration: 0,
      retries: 0,
      platform: process.platform,
      steps: [],
      attachments: [],
      logs: [],
    };
    this._currentJasmineId = result?.id;
    this._currentStartMs = Date.now();
    this.casesById.set(id, caseObj);
    ctx.current = { caseObj, stepStack: [] };
  }

  specDone(result) {
    const cur = ctx.current?.caseObj;
    if (!cur) return;
    const status = mapStatus(result?.status);
    const duration = Math.max(0, Date.now() - (this._currentStartMs || Date.now()));

    cur.status = status;
    cur.duration = duration;
    cur.finishedAt = new Date(Date.parse(cur.startedAt) + duration).toISOString();

    // Severity from `pending('blocker')` reason if not already set from tags.
    if (!cur.severity && result?.pendingReason) {
      const sev = severityFromPendingReason(result.pendingReason);
      if (sev) cur.severity = sev;
    }

    // Failed expectations become errors + each becomes a sub-step too so the
    // viewer's assertion UI lights up.
    const failed = result?.failedExpectations || [];
    if (failed.length) {
      cur.errors = failed.map(f => ({
        message: String(f.message || '').split('\n')[0] || 'Expectation failed',
        stack: String(f.stack || ''),
        type: f.matcherName,
      }));
      for (const f of failed) {
        const t0 = Date.parse(cur.startedAt) || Date.now();
        cur.steps.push({
          id: shortId('step'),
          title: f.matcherName ? `expect: ${f.matcherName}` : 'expectation failed',
          action: 'expect',
          status: 'fail',
          startedAt: new Date(t0).toISOString(),
          duration: 0,
          assertion: {
            expected: f.expected,
            received: f.actual,
            stack: f.stack,
            diff: undefined,
          },
        });
      }
    }
    if (result?.passedExpectations?.length && !cur.steps.length) {
      // Surface count of passed expectations as a single step so the case
      // shows something concrete in the viewer.
      const t0 = Date.parse(cur.startedAt) || Date.now();
      cur.steps.push({
        id: shortId('step'),
        title: `${result.passedExpectations.length} passing expectation${result.passedExpectations.length === 1 ? '' : 's'}`,
        action: 'expect',
        status: 'pass',
        startedAt: new Date(t0).toISOString(),
        duration: duration,
      });
    }

    if (!cur.errors?.length) delete cur.errors;
    if (!cur.attachments?.length) delete cur.attachments;
    if (!cur.logs?.length) delete cur.logs;
    if (!cur.labels) delete cur.labels;
    if (!cur.severity) delete cur.severity;

    try {
      writeFileSync(
        resolve(this.casesDir, cur.id + '.json'),
        JSON.stringify(cur, null, 2),
      );
    } catch (e) {
      // Never throw from a reporter.
      // eslint-disable-next-line no-console
      console.error('[kensho] failed to write case:', e?.message);
    }
    ctx.current = null;
  }

  jasmineDone() {
    const cases = [...this.casesById.values()];
    const finishedAt = new Date().toISOString();
    const run = emptyRun({
      id: this.runId,
      project: {
        name: this.project.name || 'Unknown project',
        slug: this.project.slug || 'unknown',
        url: this.project.url,
      },
      framework: { name: 'jasmine', version: process.env.JASMINE_VERSION || 'unknown' },
      env: envInfo(),
      startedAt: this.startedAt,
    });
    run.finishedAt = finishedAt;
    run.durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(this.startedAt));
    run.testCases = cases;
    run.totals = computeTotals(cases);

    try {
      writeFileSync(resolve(this.outputDir, 'run.json'), JSON.stringify(run, null, 2));
      const { ok, errors } = validateRun(run);
      if (!ok) {
        // eslint-disable-next-line no-console
        console.warn('[kensho] run.json failed validation:');
        for (const e of errors.slice(0, 8)) console.warn('  -', e);
      }
      // eslint-disable-next-line no-console
      console.log(`[kensho] wrote ${cases.length} cases + run.json to ${this.outputDir}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[kensho] jasmineDone failed:', e?.message);
    }
    ctx.reporters.delete(this);
  }
}

function safePath(p) {
  if (!p) return undefined;
  try {
    const cwd = process.cwd();
    if (p.startsWith(cwd)) return p.slice(cwd.length + 1);
  } catch {}
  return p;
}
