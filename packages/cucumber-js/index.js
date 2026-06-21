// @kaizenreport/kensho-cucumber-js — Cucumber-JS custom formatter. Consumes
// the message envelope stream. We dynamically import Formatter from
// @cucumber/cucumber at runtime so it stays an optional peer dep.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { emptyRun, computeTotals, stableCaseId, validateRun, envInfo } from '@kaizenreport/kensho-schema';
import { kensho, _open, _drain, mergeCucumberMeta } from './kensho.js';

export { kensho } from './kensho.js';

// envInfo() is imported from @kaizenreport/kensho-schema below.

function mapCucumberStatus(s) {
  // Cucumber messages TestStepResultStatus:
  // 'PASSED' | 'FAILED' | 'SKIPPED' | 'PENDING' | 'UNDEFINED' | 'AMBIGUOUS' | 'UNKNOWN'
  if (s === 'PASSED') return 'pass';
  if (s === 'FAILED') return 'fail';
  if (s === 'SKIPPED' || s === 'PENDING') return 'skip';
  return 'broken'; // UNDEFINED / AMBIGUOUS / UNKNOWN
}

function mapStepStatus(s) {
  const v = mapCucumberStatus(s);
  return v === 'broken' ? 'fail' : v;
}

function severityFromTags(tags) {
  for (const t of tags || []) {
    const m = /^@?(blocker|critical|normal|minor|trivial)$/i.exec(t);
    if (m) return m[1].toLowerCase();
  }
  return undefined;
}

function durationOf(d) {
  if (!d) return 0;
  const secs = typeof d.seconds === 'number' ? d.seconds : Number(d.seconds) || 0;
  const nanos = typeof d.nanos === 'number' ? d.nanos : Number(d.nanos) || 0;
  return Math.max(0, Math.round(secs * 1000 + nanos / 1e6));
}

function timestampToIso(ts) {
  if (!ts) return new Date().toISOString();
  const secs = typeof ts.seconds === 'number' ? ts.seconds : Number(ts.seconds) || 0;
  const nanos = typeof ts.nanos === 'number' ? ts.nanos : Number(ts.nanos) || 0;
  return new Date(secs * 1000 + nanos / 1e6).toISOString();
}

// Build the formatter class lazily so @cucumber/cucumber is only required
// when Cucumber actually loads this formatter.
async function buildKenshoFormatter() {
  const mod = await import('@cucumber/cucumber');
  const Base = mod.Formatter || mod.default?.Formatter;
  if (!Base) throw new Error('@cucumber/cucumber Formatter not found');

  return class KenshoCucumberFormatter extends Base {
    constructor(opts) {
      super(opts);
      const o = (opts && opts.parsedArgvOptions) || {};
      this.outputDir = resolve(process.cwd(), o.output || 'kensho-results');
      this.casesDir = resolve(this.outputDir, 'cases');
      this.attachmentsDir = resolve(this.outputDir, 'attachments');
      this.project = o.project || {};
      this.severityFromTag = o.severityFromTag !== false;
      this.runId = o.runId || ('run_' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14));
      this.startedAt = new Date().toISOString();

      mkdirSync(this.outputDir, { recursive: true });
      mkdirSync(this.casesDir, { recursive: true });
      mkdirSync(this.attachmentsDir, { recursive: true });

      // Accumulators keyed by id.
      this.gherkinDocs = new Map();           // uri -> { feature }
      this.pickles = new Map();                // pickleId -> pickle
      this.testCases = new Map();              // testCaseId -> { pickleId, testSteps:[{ id, pickleStepId }] }
      this.testCaseStarted = new Map();        // testCaseStartedId -> { testCaseId, timestamp }
      this.stepResults = new Map();            // testCaseStartedId -> Array<{ testStepId, status, duration, message }>
      this.finishedTestCases = new Map();      // pickleId -> kensho case
      this.casesById = new Map();

      opts.eventBroadcaster.on('envelope', (e) => this._onEnvelope(e));
    }

    _onEnvelope(envelope) {
      try {
        if (envelope.gherkinDocument) {
          this.gherkinDocs.set(envelope.gherkinDocument.uri, envelope.gherkinDocument);
        } else if (envelope.pickle) {
          this.pickles.set(envelope.pickle.id, envelope.pickle);
        } else if (envelope.testCase) {
          this.testCases.set(envelope.testCase.id, envelope.testCase);
        } else if (envelope.testCaseStarted) {
          this.testCaseStarted.set(envelope.testCaseStarted.id, envelope.testCaseStarted);
          this.stepResults.set(envelope.testCaseStarted.id, []);
          // Open the scratch the kensho.* helpers in step defs will mutate.
          _open();
        } else if (envelope.testStepFinished) {
          const arr = this.stepResults.get(envelope.testStepFinished.testCaseStartedId) || [];
          arr.push(envelope.testStepFinished);
          this.stepResults.set(envelope.testStepFinished.testCaseStartedId, arr);
        } else if (envelope.testCaseFinished) {
          this._finalizeCase(envelope.testCaseFinished);
        } else if (envelope.testRunFinished) {
          this._writeManifest();
        }
      } catch (e) {
        console.error('[kensho] cucumber envelope error:', e && e.message);
      }
    }

    _finalizeCase(finishedEvt) {
      const started = this.testCaseStarted.get(finishedEvt.testCaseStartedId);
      if (!started) return;
      const tc = this.testCases.get(started.testCaseId);
      if (!tc) return;
      const pickle = this.pickles.get(tc.pickleId);
      if (!pickle) return;

      const uri = pickle.uri;
      const doc = this.gherkinDocs.get(uri);
      const featureName = doc?.feature?.name || '';
      const filePath = uri ? relative(process.cwd(), uri) : undefined;
      const fullName = (featureName ? featureName + ' › ' : '') + pickle.name;

      let id = stableCaseId(fullName, filePath);
      if (this.casesById.has(id)) {
        let i = 2;
        while (this.casesById.has(id + '_' + i)) i++;
        id = id + '_' + i;
      }

      const tags = (pickle.tags || []).map(t => String(t.name || '').replace(/^@/, ''));
      const stepEvents = this.stepResults.get(finishedEvt.testCaseStartedId) || [];
      const pickleStepById = new Map((pickle.steps || []).map(s => [s.id, s]));
      const tcStepById = new Map((tc.testSteps || []).map(s => [s.id, s]));

      const steps = [];
      let totalDuration = 0;
      let worstStatus = 'pass';
      let firstError;
      for (let i = 0; i < stepEvents.length; i++) {
        const ev = stepEvents[i];
        const tcStep = tcStepById.get(ev.testStepId);
        const pickleStep = tcStep?.pickleStepId ? pickleStepById.get(tcStep.pickleStepId) : null;
        const title = pickleStep?.text || '(hook)';
        const d = durationOf(ev.testStepResult?.duration);
        totalDuration += d;
        const stStatus = mapStepStatus(ev.testStepResult?.status);
        if (stStatus === 'fail') worstStatus = 'fail';
        else if (stStatus === 'skip' && worstStatus !== 'fail') worstStatus = worstStatus === 'pass' ? 'skip' : worstStatus;
        if (!firstError && ev.testStepResult?.message) firstError = ev.testStepResult.message;

        steps.push({
          id: 'step_' + i + '_' + (ev.testStepId || Math.random().toString(36).slice(2, 6)),
          title,
          status: stStatus,
          startedAt: timestampToIso(started.timestamp),
          duration: d,
        });
      }

      const caseStatus = worstStatus === 'pass' && stepEvents.some(e => mapCucumberStatus(e.testStepResult?.status) === 'broken')
        ? 'broken'
        : (worstStatus || mapCucumberStatus(finishedEvt.testCaseFinished?.status));

      const startedAtIso = timestampToIso(started.timestamp);
      const finishedAtIso = timestampToIso(finishedEvt.timestamp);
      const duration = Math.max(0, Date.parse(finishedAtIso) - Date.parse(startedAtIso));

      const caseObj = {
        id,
        name: pickle.name,
        fullName,
        filePath,
        suite: featureName ? [featureName] : [],
        tags,
        severity: this.severityFromTag ? severityFromTags(tags) : undefined,
        status: caseStatus,
        startedAt: startedAtIso,
        finishedAt: finishedAtIso,
        duration,
        retries: 0,
        behavior: { feature: featureName, scenario: pickle.name },
        platform: process.platform,
        steps,
        errors: firstError ? [{ message: String(firstError).split('\n')[0], stack: String(firstError) }] : undefined,
        attachments: [],
        logs: [],
      };

      // Fold in the kensho.* helper scratch for this scenario (runtime values
      // win; kensho.step entries land after the gherkin steps).
      const buf = _drain();
      if (buf) mergeCucumberMeta(caseObj, buf);

      try {
        writeFileSync(resolve(this.casesDir, id + '.json'), JSON.stringify(caseObj, null, 2));
      } catch (e) {
        console.error('[kensho] failed to write case:', e && e.message);
      }
      this.casesById.set(id, caseObj);
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
        framework: { name: 'cucumber-js', version: process.env.CUCUMBER_VERSION || 'unknown' },
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
        console.error('[kensho] cucumber manifest failed:', e && e.message);
      }
    }
  };
}

// Cucumber imports formatters as default export. We lazy-build the class on
// first instantiation so importing this module doesn't require cucumber.
let _cls = null;
export default class KenshoCucumberFormatterProxy {
  constructor(opts) {
    if (!_cls) {
      // Synchronously importing cucumber from a constructor isn't possible,
      // so we throw if we get here without the class being prebuilt.
      throw new Error(
        '[kensho] Cucumber formatter must be loaded via Cucumber\'s formatter system. ' +
        'Ensure @cucumber/cucumber is installed.'
      );
    }
    return new _cls(opts);
  }
}

// Eagerly resolve the real class when cucumber is available so the default
// export works at Cucumber-load time.
try {
  _cls = await buildKenshoFormatter();
} catch {
  // leave _cls null; proxy throws at instantiation with a helpful message.
}
