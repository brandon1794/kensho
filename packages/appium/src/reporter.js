// WebdriverIO reporter that writes Kensho v1 JSON. Designed to ride on top of
// any framework that wdio supports (mocha / jasmine / cucumber) so the same
// adapter works for the bulk of Appium teams.
//
// We deliberately implement WDIOReporter as a soft import: many users install
// the helper API only (no wdio runner) and we don't want a hard peer.

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Writable } from 'node:stream';
import {
  emptyRun, computeTotals, stableCaseId, validateRun,
} from '@kaizenreport/kensho-schema';
import {
  envFromCI, deviceLabelsFromCaps, platformStringFromCaps, shortId, nowIso,
} from './_schema.js';
import { _bind, _drain } from './helpers.js';

let WDIOReporter;
try {
  ({ default: WDIOReporter } = await import('@wdio/reporter'));
} catch {
  // Provide a tiny shim so this file still imports without the peer present.
  WDIOReporter = class { constructor() {} };
}

function severityFromTags(tags) {
  for (const t of tags || []) {
    const m = /^@?(blocker|critical|normal|minor|trivial)$/i.exec(t);
    if (m) return m[1].toLowerCase();
  }
  return undefined;
}

function mapStatus(state) {
  if (state === 'passed') return 'pass';
  if (state === 'failed') return 'fail';
  if (state === 'skipped' || state === 'pending') return 'skip';
  return 'broken';
}

export default class KenshoAppiumReporter extends WDIOReporter {
  /**
   * @param {{
   *   output?: string,
   *   project?: { name?: string, slug?: string, url?: string },
   *   severityFromTag?: boolean,
   *   captureCommands?: boolean,   // default true — surface each Appium command as a step
   *   screenshotOnFailure?: boolean,
   *   runId?: string,
   * }} [opts]
   */
  constructor(opts = {}) {
    // WDIOReporter expects either a `logFile` path or `stdout + writeStream`.
    // When users wire us up via wdio, the runner injects both; for direct/seed
    // use (no wdio), pipe its diagnostic output into a no-op sink so we don't
    // crash and don't pollute stdout.
    const sink = new Writable({ write(_chunk, _enc, cb) { cb(); } });
    const baseOpts = (opts && opts.logFile)
      ? opts
      : { ...opts, stdout: true, writeStream: opts?.writeStream || sink };
    super(baseOpts);
    this.outputDir = resolve(process.cwd(), opts.output || 'kensho-results');
    this.attachmentsDir = resolve(this.outputDir, 'attachments');
    this.casesDir = resolve(this.outputDir, 'cases');
    this.project = opts.project || {};
    this.severityFromTag = opts.severityFromTag !== false;
    this.captureCommands = opts.captureCommands !== false;
    this.screenshotOnFailure = opts.screenshotOnFailure !== false;
    this.runId = opts.runId || ('run_' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14));
    this.casesById = new Map();
    this.startedAt = nowIso();
    this.caps = null;
    this.appiumVersion = process.env.APPIUM_VERSION || 'unknown';
    this._suiteChain = [];
    this._activeId = null;
    this._activeStartMs = null;
    this._cmdBuffer = [];

    mkdirSync(this.outputDir, { recursive: true });
    mkdirSync(this.attachmentsDir, { recursive: true });
    mkdirSync(this.casesDir, { recursive: true });
  }

  get isSynchronised() { return true; }

  onRunnerStart(runner) {
    this.caps = runner?.capabilities || runner?.config?.capabilities || null;
    this.appiumVersion = runner?.config?.appiumVersion || this.appiumVersion;
    this.startedAt = nowIso();
  }

  onSuiteStart(suite) {
    if (suite?.title) this._suiteChain.push(suite.title);
  }

  onSuiteEnd() {
    this._suiteChain.pop();
  }

  onTestStart(test) {
    const fullName = [...this._suiteChain, test.title].filter(Boolean).join(' › ');
    let id = stableCaseId(fullName, test.file || undefined);
    if (this.casesById.has(id)) {
      let i = 2;
      while (this.casesById.has(id + '_' + i)) i++;
      id = id + '_' + i;
    }
    this._activeId = id;
    this._activeStartMs = Date.now();
    this._cmdBuffer = [];
    _bind({ attachmentsRoot: this.attachmentsDir, currentId: id });
  }

  onBeforeCommand(cmd) {
    if (!this.captureCommands || !this._activeId) return;
    cmd.__kStart = Date.now();
  }

  onAfterCommand(cmd) {
    if (!this.captureCommands || !this._activeId) return;
    const dur = Math.max(0, Date.now() - (cmd.__kStart || Date.now()));
    const sel = (cmd.body && (cmd.body.using ? `${cmd.body.using}=${cmd.body.value}` : (cmd.body.text || cmd.body.value))) || '';
    this._cmdBuffer.push({
      id: shortId('step'),
      title: cmd.command + (sel ? ` — ${String(sel).slice(0, 80)}` : ''),
      action: cmd.command,
      target: sel ? String(sel) : undefined,
      status: 'pass',
      startedAt: new Date(cmd.__kStart || Date.now()).toISOString(),
      duration: dur,
    });
  }

  onTestEnd(test) {
    try {
      const id = this._activeId;
      const buf = _drain(id) || { steps: [], attachments: [], labels: {}, links: [] };
      _bind({ attachmentsRoot: this.attachmentsDir, currentId: null });

      const fullName = [...this._suiteChain, test.title].filter(Boolean).join(' › ');
      const tags = test.tags || [];
      const status = mapStatus(test.state);
      const duration = Math.max(0, Math.round(test.duration || (Date.now() - (this._activeStartMs || Date.now()))));
      const startedAt = test._start ? new Date(test._start).toISOString() : new Date(this._activeStartMs || Date.now()).toISOString();
      const finishedAt = new Date(Date.parse(startedAt) + duration).toISOString();

      const errors = test.error ? [{
        message: String(test.error.message || test.error),
        stack: test.error.stack,
        type: test.error.name,
      }] : (Array.isArray(test.errors) ? test.errors.map(e => ({ message: String(e.message || e), stack: e.stack, type: e.name })) : undefined);

      const labels = { ...deviceLabelsFromCaps(this.caps), ...buf.labels };

      const steps = [...this._cmdBuffer, ...buf.steps];

      const caseObj = {
        id,
        name: test.title,
        fullName,
        filePath: test.file || undefined,
        suite: [...this._suiteChain],
        tags,
        severity: this.severityFromTag ? severityFromTags(tags) : undefined,
        labels: Object.keys(labels).length ? labels : undefined,
        status,
        startedAt,
        finishedAt,
        duration,
        retries: test.retries || 0,
        platform: platformStringFromCaps(this.caps),
        steps,
        errors: errors && errors.length ? errors : undefined,
        attachments: buf.attachments,
        logs: [],
        links: buf.links.length ? buf.links : undefined,
      };
      writeFileSync(resolve(this.casesDir, caseObj.id + '.json'), JSON.stringify(caseObj, null, 2));
      this.casesById.set(caseObj.id, caseObj);
      this._activeId = null;
      this._cmdBuffer = [];
    } catch (e) {
      console.error('[kensho] appium reporter onTestEnd failed:', e && e.message);
    }
  }

  onRunnerEnd() {
    const cases = [...this.casesById.values()];
    const finishedAt = nowIso();
    const env = envFromCI();
    if (this.caps?.platformVersion) env.osVersion = String(this.caps.platformVersion);
    if (this.caps?.deviceName) env.device = String(this.caps.deviceName);
    if (this.caps?.app) env.appVersion = process.env.APP_VERSION || env.appVersion;
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

    try {
      writeFileSync(resolve(this.outputDir, 'run.json'), JSON.stringify(run, null, 2));
      const { ok, errors } = validateRun(run);
      if (!ok) {
        console.warn('[kensho] run.json failed validation:');
        for (const e of errors.slice(0, 8)) console.warn('  -', e);
      }
      console.log(`[kensho] wrote ${cases.length} cases + run.json to ${this.outputDir}`);
    } catch (e) {
      console.error('[kensho] appium reporter onRunnerEnd failed:', e && e.message);
    }
  }
}
