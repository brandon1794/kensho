// @kaizenreport/kensho-appium — public surface.
//
// Two integration paths:
//   1. WebdriverIO reporter (default export):
//        // wdio.conf.js
//        reporters: [['@kaizenreport/kensho-appium', { project: { name: 'Acme Mobile', slug: 'acme-mobile' } }]],
//   2. Generic Node hook for mocha/jest/jasmine + raw appium client:
//        import { kensho, KenshoAppiumSession } from '@kaizenreport/kensho-appium';
//        const session = new KenshoAppiumSession({ project: { name, slug }, capabilities });
//        before(async () => session.beforeAll());
//        after(async () => session.afterAll());
//        beforeEach(function() { session.wrapTest(this.currentTest); });
//        afterEach(function()  { session.endTest(this.currentTest); });
//
// Both paths share the same `kensho.step / attach / label / link` helper API.

import KenshoAppiumReporter from './src/reporter.js';
import { kensho, _bind, _drain, mergeAppiumMeta } from './src/helpers.js';
import {
  envFromCI, deviceLabelsFromCaps, platformStringFromCaps, nowIso,
} from './src/_schema.js';
import {
  emptyRun, computeTotals, stableCaseId, validateRun,
} from '@kaizenreport/kensho-schema';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export default KenshoAppiumReporter;
export { KenshoAppiumReporter, kensho, mergeAppiumMeta };

/**
 * Generic Node hook usable from any framework that doesn't run under wdio.
 * Manages the kensho-results/ output directory and exposes
 * `beforeAll/afterAll/wrapTest/endTest` to be wired into your test runner.
 */
export class KenshoAppiumSession {
  constructor(opts = {}) {
    this.outputDir = resolve(process.cwd(), opts.output || 'kensho-results');
    this.attachmentsDir = resolve(this.outputDir, 'attachments');
    this.casesDir = resolve(this.outputDir, 'cases');
    this.project = opts.project || {};
    this.capabilities = opts.capabilities || {};
    this.appiumVersion = opts.appiumVersion || process.env.APPIUM_VERSION || 'unknown';
    this.runId = opts.runId || ('run_' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14));
    this.startedAt = nowIso();
    this.casesById = new Map();
    this._activeId = null;
    this._activeStart = null;
  }

  beforeAll() {
    mkdirSync(this.outputDir, { recursive: true });
    mkdirSync(this.attachmentsDir, { recursive: true });
    mkdirSync(this.casesDir, { recursive: true });
    this.startedAt = nowIso();
  }

  /** Begin tracking a test. `test` may be mocha's `this.currentTest` or a plain {title,file}. */
  wrapTest(test) {
    const title = test?.title || test?.name || 'unnamed';
    const file = test?.file || test?.testPath || undefined;
    const fullName = test?.fullTitle ? (typeof test.fullTitle === 'function' ? test.fullTitle() : test.fullTitle) : title;
    let id = stableCaseId(fullName, file);
    if (this.casesById.has(id)) {
      let i = 2;
      while (this.casesById.has(id + '_' + i)) i++;
      id = id + '_' + i;
    }
    this._activeId = id;
    this._activeStart = Date.now();
    _bind({ attachmentsRoot: this.attachmentsDir, currentId: id });
    return id;
  }

  /** Close out a test. Call from afterEach with mocha's `this.currentTest` or jest result. */
  endTest(test) {
    if (!this._activeId) return;
    const buf = _drain(this._activeId) || { steps: [], attachments: [], labels: {}, links: [] };
    _bind({ attachmentsRoot: this.attachmentsDir, currentId: null });

    const title = test?.title || test?.name || 'unnamed';
    const file = test?.file || undefined;
    const fullName = test?.fullTitle ? (typeof test.fullTitle === 'function' ? test.fullTitle() : test.fullTitle) : title;
    const state = test?.state || (test?.status === 'passed' ? 'passed' : test?.status === 'failed' ? 'failed' : test?.skipped ? 'skipped' : 'passed');
    const status = state === 'passed' ? 'pass' : state === 'failed' ? 'fail' : state === 'pending' || state === 'skipped' ? 'skip' : 'broken';
    const duration = Math.max(0, Math.round(test?.duration || (Date.now() - (this._activeStart || Date.now()))));
    const startedAt = new Date(this._activeStart || Date.now()).toISOString();
    const finishedAt = new Date(Date.parse(startedAt) + duration).toISOString();

    const labels = { ...deviceLabelsFromCaps(this.capabilities), ...buf.labels };
    const errors = test?.err ? [{ message: String(test.err.message || test.err), stack: test.err.stack, type: test.err.name }]
      : test?.error ? [{ message: String(test.error.message || test.error), stack: test.error.stack, type: test.error.name }]
      : undefined;

    const caseObj = {
      id: this._activeId,
      name: title,
      fullName,
      filePath: file,
      suite: test?.parent?.title ? [test.parent.title] : [],
      tags: test?.tags || [],
      labels: Object.keys(labels).length ? labels : undefined,
      status,
      startedAt,
      finishedAt,
      duration,
      retries: test?.retries?.() || test?.invocations || 0,
      platform: platformStringFromCaps(this.capabilities),
      steps: buf.steps,
      errors,
      attachments: buf.attachments,
      logs: [],
      links: buf.links.length ? buf.links : undefined,
    };
    // Fold in the rest of the kensho.* helper buffer (behavior/severity/owner/
    // description/tags/parameters/flaky/muted). Runtime values win.
    mergeAppiumMeta(caseObj, buf);
    writeFileSync(resolve(this.casesDir, caseObj.id + '.json'), JSON.stringify(caseObj, null, 2));
    this.casesById.set(caseObj.id, caseObj);
    this._activeId = null;
  }

  afterAll() {
    const cases = [...this.casesById.values()];
    const finishedAt = nowIso();
    const env = envFromCI();
    if (this.capabilities?.platformVersion) env.osVersion = String(this.capabilities.platformVersion);
    if (this.capabilities?.deviceName) env.device = String(this.capabilities.deviceName);
    if (process.env.APP_VERSION) env.appVersion = process.env.APP_VERSION;

    const run = emptyRun({
      id: this.runId,
      project: {
        name: this.project.name || 'Unknown project',
        slug: this.project.slug || 'unknown',
        url: this.project.url,
      },
      framework: { name: 'appium', version: this.appiumVersion },
      env,
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
