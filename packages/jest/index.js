// @kaizenreport/kensho-jest — Jest reporter. Implements onTestResult /
// onRunComplete and writes kensho-results/run.json + cases/<id>.json.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { emptyRun, computeTotals, stableCaseId, validateRun, envInfo } from '@kaizenreport/kensho-schema';
import { kensho, readAnnotations, mergeAnnotations } from './src/annotations.js';

// Re-export the annotation + runtime-marker API so users can
// `import { kensho } from '@kaizenreport/kensho-jest'` inside their tests.
// readAnnotations/mergeAnnotations are also exported so adapters built on Jest
// (e.g. @kaizenreport/kensho-detox) can reuse the same sidecar merge.
export { kensho, readAnnotations, mergeAnnotations };

// envInfo() is imported from @kaizenreport/kensho-schema below.

function mapStatus(jestStatus) {
  // Jest statuses: 'passed' | 'failed' | 'skipped' | 'pending' | 'todo' | 'disabled' | 'focused'
  if (jestStatus === 'passed' || jestStatus === 'focused') return 'pass';
  if (jestStatus === 'failed') return 'fail';
  if (jestStatus === 'skipped' || jestStatus === 'pending' || jestStatus === 'todo' || jestStatus === 'disabled') return 'skip';
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

export default class KenshoJestReporter {
  /**
   * @param {*} globalConfig
   * @param {{ output?: string, project?: {name?:string, slug?:string, url?:string}, severityFromTag?: boolean, runId?: string }} [options]
   */
  constructor(globalConfig, options = {}) {
    this.globalConfig = globalConfig;
    this.outputDir = resolve(process.cwd(), options.output || 'kensho-results');
    this.casesDir = resolve(this.outputDir, 'cases');
    this.attachmentsDir = resolve(this.outputDir, 'attachments');
    this.project = options.project || {};
    this.severityFromTag = options.severityFromTag !== false;
    this.runId = options.runId || ('run_' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14));
    this.startedAt = new Date().toISOString();
    this.casesById = new Map();
    // Tell the annotation API (running in worker processes) where to flush its
    // sidecar files so this reporter can read them back.
    process.env.KENSHO_OUTPUT = options.output || 'kensho-results';

    mkdirSync(this.outputDir, { recursive: true });
    mkdirSync(this.casesDir, { recursive: true });
    mkdirSync(this.attachmentsDir, { recursive: true });
  }

  onTestResult(_test, testResult /* , aggregatedResult */) {
    try {
      const filePath = testResult.testFilePath
        ? relative(process.cwd(), testResult.testFilePath)
        : undefined;
      for (const t of testResult.testResults || []) {
        const caseObj = this._toKenshoCase(t, filePath, testResult);
        writeFileSync(
          resolve(this.casesDir, caseObj.id + '.json'),
          JSON.stringify(caseObj, null, 2),
        );
        this.casesById.set(caseObj.id, caseObj);
      }
    } catch (e) {
      console.error('[kensho] jest onTestResult failed:', e && e.message);
    }
  }

  onRunComplete(_contexts, results) {
    const cases = [...this.casesById.values()];
    const finishedAt = new Date().toISOString();
    const run = emptyRun({
      id: this.runId,
      project: {
        name: this.project.name || 'Unknown project',
        slug: this.project.slug || 'unknown',
        url: this.project.url,
      },
      framework: { name: 'jest', version: process.env.JEST_VERSION || 'unknown' },
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
        console.warn('[kensho] run.json failed validation:');
        for (const e of errors.slice(0, 8)) console.warn('  -', e);
      }
      console.log(`[kensho] wrote ${cases.length} cases + run.json to ${this.outputDir}`);
    } catch (e) {
      console.error('[kensho] jest onRunComplete failed:', e && e.message);
    }
  }

  _toKenshoCase(t, filePath, testResult) {
    const suite = Array.isArray(t.ancestorTitles) ? t.ancestorTitles.slice() : [];
    const name = t.title || 'unnamed';
    const fullName = t.fullName || suite.concat(name).join(' › ');
    let id = stableCaseId(fullName, filePath);
    if (this.casesById.has(id)) {
      let i = 2;
      while (this.casesById.has(id + '_' + i)) i++;
      id = id + '_' + i;
    }
    const tags = extractInlineTags(name);
    const duration = Math.max(0, Math.round(t.duration || 0));
    const startMs = (testResult && testResult.perfStats && testResult.perfStats.start) || Date.now();
    const startedAt = new Date(startMs).toISOString();

    const errors = (t.failureMessages || []).map(m => ({
      message: String(m).split('\n')[0],
      stack: String(m),
    }));

    const caseObj = {
      id,
      name,
      fullName,
      filePath,
      line: t.location?.line,
      suite,
      tags,
      severity: this.severityFromTag ? severityFromTags(tags) : undefined,
      status: mapStatus(t.status),
      startedAt,
      finishedAt: new Date(startMs + duration).toISOString(),
      duration,
      retries: t.invocations ? Math.max(0, (t.invocations - 1)) : 0,
      platform: process.platform,
      steps: [],
      errors: errors.length ? errors : undefined,
      attachments: [],
      logs: [],
    };
    return mergeAnnotations(caseObj, readAnnotations(this.outputDir, fullName));
  }
}
