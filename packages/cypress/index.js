// @kaizenreport/kensho-cypress — Cypress reporter (built on Mocha's reporter API).
// Collects pass/fail/pending events from the Mocha runner, then writes
// kensho-results/run.json + cases/<id>.json on the runner 'end' event.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { emptyRun, computeTotals, stableCaseId, validateRun, envInfo } from '@kaizenreport/kensho-schema';
import { readAnnotations, mergeAnnotations } from './src/sidecar.js';
export { kensho } from './src/annotations.js';
export { registerKenshoTasks } from './src/task.js';

// The `kensho` annotation + runtime-marker API runs in the browser
// (./src/annotations.js) and ships records to Node via cy.task; the Node task
// (registerKenshoTasks) writes a sidecar this reporter merges below. Users
// `import { kensho } from '@kaizenreport/kensho-cypress'` in their specs and
// call `registerKenshoTasks(on, config)` in setupNodeEvents.

// envInfo() is imported from @kaizenreport/kensho-schema below.

function suiteChainOf(test) {
  const chain = [];
  for (let s = test.parent; s; s = s.parent) {
    if (s.title) chain.unshift(s.title);
  }
  return chain;
}

function mapMochaStatus(state) {
  if (state === 'passed') return 'pass';
  if (state === 'failed') return 'fail';
  if (state === 'pending') return 'skip';
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

export default class KenshoCypressReporter {
  /**
   * Mocha-style reporter constructor.
   * @param {*} runner - Mocha Runner
   * @param {{ reporterOptions?: any }} opts
   */
  constructor(runner, opts = {}) {
    const options = (opts && opts.reporterOptions) || {};
    this.outputDir = resolve(process.cwd(), options.output || 'kensho-results');
    this.casesDir = resolve(this.outputDir, 'cases');
    this.attachmentsDir = resolve(this.outputDir, 'attachments');
    this.project = options.project || {};
    this.severityFromTag = options.severityFromTag !== false;
    this.runId = options.runId || ('run_' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14));
    this.startedAt = new Date().toISOString();
    this.casesById = new Map();
    // Keep the sidecar dir aligned with this reporter's output so the Node task
    // and the reporter read/write the same .annotations/ folder.
    process.env.KENSHO_OUTPUT = options.output || 'kensho-results';

    mkdirSync(this.outputDir, { recursive: true });
    mkdirSync(this.casesDir, { recursive: true });
    mkdirSync(this.attachmentsDir, { recursive: true });

    if (!runner) return; // allow instantiation for tests without a runner

    runner.on('pass', (test) => this._record(test, 'pass'));
    runner.on('fail', (test, err) => this._record(test, 'fail', err));
    runner.on('pending', (test) => this._record(test, 'skip'));
    runner.on('end', () => this._finalize(runner));
  }

  _record(test, statusLabel, err) {
    try {
      const caseObj = this._toKenshoCase(test, statusLabel, err);
      writeFileSync(
        resolve(this.casesDir, caseObj.id + '.json'),
        JSON.stringify(caseObj, null, 2),
      );
      this.casesById.set(caseObj.id, caseObj);
    } catch (e) {
      console.error('[kensho] failed to write case:', e && e.message);
    }
  }

  _toKenshoCase(test, statusLabel, err) {
    const suite = suiteChainOf(test);
    const fullName = suite.concat(test.title || '').join(' › ');
    const filePath = test.file ? relative(process.cwd(), test.file) : undefined;
    let id = stableCaseId(fullName, filePath);
    if (this.casesById.has(id)) {
      let i = 2;
      while (this.casesById.has(id + '_' + i)) i++;
      id = id + '_' + i;
    }
    const tags = extractInlineTags(test.title);
    const duration = Math.max(0, Math.round(test.duration || 0));
    const startedAt = new Date().toISOString();

    const errors = err ? [{
      message: String(err.message || err),
      stack: err.stack,
      type: err.name,
    }] : undefined;

    const caseObj = {
      id,
      name: test.title || 'unnamed',
      fullName,
      filePath,
      suite,
      tags,
      severity: this.severityFromTag ? severityFromTags(tags) : undefined,
      status: mapMochaStatus(statusLabel === 'pass' ? 'passed' : statusLabel === 'fail' ? 'failed' : 'pending'),
      startedAt,
      finishedAt: new Date(Date.parse(startedAt) + duration).toISOString(),
      duration,
      retries: (test.currentRetry && test.currentRetry()) || 0,
      platform: process.platform,
      steps: [],
      errors,
      attachments: [],
      logs: [],
    };
    return mergeAnnotations(caseObj, readAnnotations(this.outputDir, fullName));
  }

  _finalize() {
    const cases = [...this.casesById.values()];
    const finishedAt = new Date().toISOString();
    const run = emptyRun({
      id: this.runId,
      project: {
        name: this.project.name || 'Unknown project',
        slug: this.project.slug || 'unknown',
        url: this.project.url,
      },
      framework: { name: 'cypress', version: process.env.CYPRESS_VERSION || 'unknown' },
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
