// @kaizenreport/kensho-vitest — Vitest custom reporter → kensho-results/.
//
// Supports both reporter APIs:
//   • vitest 2.1+/3/4: onTestRunEnd(testModules) — the stable Reported Tasks API
//     (TestModule / TestCase). This is what current Vitest invokes.
//   • vitest 1.x–2.0: onFinished(files) — the legacy task-tree API (fallback).
// A guard ensures only the first hook to fire writes the report.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { emptyRun, computeTotals, stableCaseId, validateRun, envInfo } from '@kaizenreport/kensho-schema';

function mapStatus(task) {
  // Legacy task.result.state: 'pass' | 'fail' | 'skip' | 'todo' | 'only' | 'run'
  const state = task?.result?.state;
  const mode = task?.mode;
  if (mode === 'skip' || mode === 'todo' || state === 'skip' || state === 'todo') return 'skip';
  if (state === 'pass') return 'pass';
  if (state === 'fail') return 'fail';
  return 'broken';
}

function mapReportedState(state) {
  // Reported Tasks API TestResult.state: 'passed' | 'failed' | 'skipped' | 'pending'
  if (state === 'passed') return 'pass';
  if (state === 'failed') return 'fail';
  if (state === 'skipped' || state === 'pending') return 'skip';
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

function walkTests(task, suiteChain, out) {
  if (task.type === 'suite') {
    const nextChain = task.name ? suiteChain.concat(task.name) : suiteChain;
    for (const child of task.tasks || []) walkTests(child, nextChain, out);
  } else if (task.type === 'test' || task.type === 'custom') {
    out.push({ task, suiteChain });
  }
}

export default class KenshoVitestReporter {
  constructor(opts = {}) {
    this.outputDir = resolve(process.cwd(), opts.output || 'kensho-results');
    this.casesDir = resolve(this.outputDir, 'cases');
    this.attachmentsDir = resolve(this.outputDir, 'attachments');
    this.project = opts.project || {};
    this.severityFromTag = opts.severityFromTag !== false;
    this.runId = opts.runId || ('run_' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14));
    this.startedAt = new Date().toISOString();
    this.casesById = new Map();
    this._emitted = false;
  }

  onInit(/* ctx */) {
    mkdirSync(this.outputDir, { recursive: true });
    mkdirSync(this.casesDir, { recursive: true });
    mkdirSync(this.attachmentsDir, { recursive: true });
    this.startedAt = new Date().toISOString();
  }

  // ── vitest 2.1+/3/4 — Reported Tasks API ────────────────────────────────
  onTestRunEnd(testModules /* , unhandledErrors, reason */) {
    if (this._emitted) return;
    try {
      for (const mod of testModules || []) {
        const filePath = mod.moduleId ? relative(process.cwd(), mod.moduleId) : undefined;
        for (const tc of mod.children.allTests()) {
          const caseObj = this._toKenshoCaseReported(tc, filePath);
          writeFileSync(resolve(this.casesDir, caseObj.id + '.json'), JSON.stringify(caseObj, null, 2));
          this.casesById.set(caseObj.id, caseObj);
        }
      }
      this._emitted = true;
      this._writeManifest();
    } catch (e) {
      console.error('[kensho] vitest reporter (onTestRunEnd) failed:', (e && e.stack) || e);
    }
  }

  // ── vitest 1.x–2.0 — legacy task-tree API ───────────────────────────────
  onFinished(files = [] /* , errors = [] */) {
    if (this._emitted) return;
    try {
      const collected = [];
      for (const f of files || []) walkTests(f, [], collected);
      for (const { task, suiteChain } of collected) {
        const caseObj = this._toKenshoCase(task, suiteChain);
        writeFileSync(resolve(this.casesDir, caseObj.id + '.json'), JSON.stringify(caseObj, null, 2));
        this.casesById.set(caseObj.id, caseObj);
      }
      this._emitted = true;
      this._writeManifest();
    } catch (e) {
      console.error('[kensho] vitest reporter (onFinished) failed:', (e && e.stack) || e);
    }
  }

  _uniqueId(fullName, filePath) {
    let id = stableCaseId(fullName, filePath);
    if (this.casesById.has(id)) {
      let i = 2;
      while (this.casesById.has(id + '_' + i)) i++;
      id = id + '_' + i;
    }
    return id;
  }

  _toKenshoCaseReported(tc, filePath) {
    const name = tc.name || 'unnamed';
    const fullName = tc.fullName || name;
    const suiteChain = fullName.includes(' > ') ? fullName.split(' > ').slice(0, -1) : [];
    const id = this._uniqueId(fullName, filePath);
    const res = (typeof tc.result === 'function' ? tc.result() : tc.result) || {};
    const diag = (typeof tc.diagnostic === 'function' ? tc.diagnostic() : {}) || {};
    const duration = Math.max(0, Math.round(diag.duration || 0));
    const startMs = diag.startTime || Date.now();
    const tags = extractInlineTags(name);
    const errors = (res.errors || []).map(e => ({
      message: String(e.message || e), stack: e.stack, type: e.name,
    }));
    return {
      id, name, fullName, filePath,
      suite: suiteChain,
      tags,
      severity: this.severityFromTag ? severityFromTags(tags) : undefined,
      status: mapReportedState(res.state),
      startedAt: new Date(startMs).toISOString(),
      finishedAt: new Date(startMs + duration).toISOString(),
      duration,
      retries: diag.retryCount || 0,
      platform: process.platform,
      steps: [],
      errors: errors.length ? errors : undefined,
      attachments: [],
      logs: [],
    };
  }

  _toKenshoCase(task, suiteChain) {
    const name = task.name || 'unnamed';
    const filePath = (task.file?.filepath || task.file?.name)
      ? relative(process.cwd(), task.file.filepath || task.file.name)
      : undefined;
    const fullName = suiteChain.concat(name).join(' › ');
    const id = this._uniqueId(fullName, filePath);
    const tags = extractInlineTags(name);
    const duration = Math.max(0, Math.round(task.result?.duration || 0));
    const startMs = task.result?.startTime || Date.now();
    const errors = (task.result?.errors || []).map(e => ({
      message: String(e.message || e), stack: e.stack, type: e.name,
    }));
    return {
      id, name, fullName, filePath,
      suite: suiteChain,
      tags,
      severity: this.severityFromTag ? severityFromTags(tags) : undefined,
      status: mapStatus(task),
      startedAt: new Date(startMs).toISOString(),
      finishedAt: new Date(startMs + duration).toISOString(),
      duration,
      retries: task.result?.retryCount || 0,
      platform: process.platform,
      steps: [],
      errors: errors.length ? errors : undefined,
      attachments: [],
      logs: [],
    };
  }

  _writeManifest() {
    const cases = [...this.casesById.values()];
    const finishedAt = new Date().toISOString();
    const run = emptyRun({
      id: this.runId,
      project: {
        name: this.project.name || 'Unknown project',
        slug: this.project.slug || 'unknown',
        url: this.project.url,
      },
      framework: { name: 'vitest', version: process.env.VITEST_VERSION || 'unknown' },
      env: envInfo(),
      startedAt: this.startedAt,
    });
    run.finishedAt = finishedAt;
    run.durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(this.startedAt));
    run.testCases = cases;
    run.totals = computeTotals(cases);

    writeFileSync(resolve(this.outputDir, 'run.json'), JSON.stringify(run, null, 2));
    const { ok, errors } = validateRun(run);
    if (!ok) {
      console.warn('[kensho] run.json failed validation:');
      for (const e of errors.slice(0, 8)) console.warn('  -', e);
    }
    console.log(`[kensho] wrote ${cases.length} cases + run.json to ${this.outputDir}`);
  }
}
