// @kaizenreport/kensho-vitest — Vitest custom reporter. Walks the Vitest task
// tree on onFinished() and writes kensho-results/run.json + cases/<id>.json.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { emptyRun, computeTotals, stableCaseId, validateRun, envInfo } from '@kaizenreport/kensho-schema';

// envInfo() is imported from @kaizenreport/kensho-schema below.

function mapStatus(task) {
  // Vitest task.result.state: 'pass' | 'fail' | 'skip' | 'todo' | 'only' | 'run'
  const state = task?.result?.state;
  const mode = task?.mode;
  if (mode === 'skip' || mode === 'todo' || state === 'skip' || state === 'todo') return 'skip';
  if (state === 'pass') return 'pass';
  if (state === 'fail') return 'fail';
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
  // Vitest task types: 'suite' | 'test' | 'custom'
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
  }

  onInit(/* ctx */) {
    mkdirSync(this.outputDir, { recursive: true });
    mkdirSync(this.casesDir, { recursive: true });
    mkdirSync(this.attachmentsDir, { recursive: true });
    this.startedAt = new Date().toISOString();
  }

  onFinished(files = [] /* , errors = [] */) {
    try {
      const collected = [];
      for (const f of files || []) {
        // File-level task: its own name is the file path; its tasks are describe/suite blocks.
        walkTests(f, [], collected);
        this._filePath = f.filepath || f.name;
      }
      for (const { task, suiteChain } of collected) {
        const caseObj = this._toKenshoCase(task, suiteChain);
        writeFileSync(
          resolve(this.casesDir, caseObj.id + '.json'),
          JSON.stringify(caseObj, null, 2),
        );
        this.casesById.set(caseObj.id, caseObj);
      }
      this._writeManifest();
    } catch (e) {
      console.error('[kensho] vitest reporter failed:', e && e.message);
    }
  }

  _toKenshoCase(task, suiteChain) {
    const name = task.name || 'unnamed';
    const filePath = (task.file?.filepath || task.file?.name)
      ? relative(process.cwd(), task.file.filepath || task.file.name)
      : undefined;
    const fullName = suiteChain.concat(name).join(' › ');
    let id = stableCaseId(fullName, filePath);
    if (this.casesById.has(id)) {
      let i = 2;
      while (this.casesById.has(id + '_' + i)) i++;
      id = id + '_' + i;
    }
    const tags = extractInlineTags(name);
    const duration = Math.max(0, Math.round(task.result?.duration || 0));
    const startMs = task.result?.startTime || Date.now();
    const startedAt = new Date(startMs).toISOString();

    const errors = (task.result?.errors || []).map(e => ({
      message: String(e.message || e),
      stack: e.stack,
      type: e.name,
    }));

    // Nested tasks (e.g. test.each or custom child tasks) → Kensho steps.
    const steps = [];
    if (Array.isArray(task.tasks) && task.tasks.length) {
      task.tasks.forEach((child, i) => {
        const childStatus = mapStatus(child);
        steps.push({
          id: 'step_' + i + '_' + Math.random().toString(36).slice(2, 6),
          title: child.name || `Step ${i + 1}`,
          status: childStatus === 'fail' ? 'fail' : childStatus === 'skip' ? 'skip' : 'pass',
          startedAt: new Date(child.result?.startTime || startMs).toISOString(),
          duration: Math.max(0, Math.round(child.result?.duration || 0)),
        });
      });
    }

    return {
      id,
      name,
      fullName,
      filePath,
      suite: suiteChain,
      tags,
      severity: this.severityFromTag ? severityFromTags(tags) : undefined,
      status: mapStatus(task),
      startedAt,
      finishedAt: new Date(startMs + duration).toISOString(),
      duration,
      retries: task.result?.retryCount || 0,
      platform: process.platform,
      steps,
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
