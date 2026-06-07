// @kaizenreport/kensho-playwright — Playwright reporter that emits Kensho v1
// JSON (one file per test case + a run.json manifest) plus copies all
// artifacts into kensho-results/attachments/ so the whole folder is a
// self-contained, portable result bundle.

import { mkdirSync, writeFileSync, copyFileSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve, basename, relative, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { emptyRun, computeTotals, stableCaseId, validateRun, envInfo } from '@kaizenreport/kensho-schema';

const MIME_BY_EXT = {
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.webp':'image/webp', '.webm':'video/webm', '.mp4':'video/mp4',
  '.zip':'application/zip', '.html':'text/html',
  '.json':'application/json', '.txt':'text/plain', '.log':'text/plain',
  '.har':'application/json',
};

const KIND_BY_EXT = {
  '.png':'screenshot', '.jpg':'screenshot', '.jpeg':'screenshot', '.webp':'screenshot',
  '.webm':'video', '.mp4':'video',
  '.zip':'trace', // Playwright traces are .zip
  '.html':'html', '.json':'json', '.txt':'text', '.log':'log',
  '.har':'har',
};

function severityFromTags(tags) {
  for (const t of tags || []) {
    const m = /^@?(blocker|critical|normal|minor|trivial)$/i.exec(t);
    if (m) return m[1].toLowerCase();
  }
  return undefined;
}

function shortId(prefix) {
  return prefix + '-' + Math.random().toString(36).slice(2, 10);
}

function fileHash(p) {
  const h = createHash('sha256');
  h.update(existsSync(p) ? statSync(p).size + ':' + p : p);
  return h.digest('hex').slice(0, 16);
}

export default class KenshoPlaywrightReporter {
  /**
   * @param {{
   *   output?: string,        // directory for kensho-results (default "kensho-results")
   *   project?: { name?: string, slug?: string, url?: string },
   *   severityFromTag?: boolean,
   *   runId?: string,
   * }} [opts]
   */
  constructor(opts = {}) {
    this.outputDir = resolve(process.cwd(), opts.output || 'kensho-results');
    this.attachmentsDir = resolve(this.outputDir, 'attachments');
    this.casesDir = resolve(this.outputDir, 'cases');
    this.project = opts.project || {};
    this.severityFromTag = opts.severityFromTag !== false;
    this.runId = opts.runId || ('run_' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14));
    this.casesById = new Map();
    this.startedAt = new Date().toISOString();
    this.playwrightVersion = '1.x';
  }

  printsToStdio() { return false; }

  onBegin(config, suite) {
    mkdirSync(this.outputDir, { recursive: true });
    mkdirSync(this.attachmentsDir, { recursive: true });
    mkdirSync(this.casesDir, { recursive: true });
    this.playwrightVersion = config?.version || this.playwrightVersion;
    this.totalCases = suite?.allTests ? suite.allTests().length : 0;
  }

  onTestEnd(test, result) {
    try {
      const caseObj = this._toKenshoCase(test, result);
      writeFileSync(
        resolve(this.casesDir, caseObj.id + '.json'),
        JSON.stringify(caseObj, null, 2),
      );
      this.casesById.set(caseObj.id, caseObj);
    } catch (e) {
      // Never throw from a reporter.
      console.error('[kensho] failed to write case:', e && e.message);
    }
  }

  async onEnd(result) {
    const cases = [...this.casesById.values()];
    const finishedAt = new Date().toISOString();
    const run = emptyRun({
      id: this.runId,
      project: {
        name: this.project.name || 'Unknown project',
        slug: this.project.slug || 'unknown',
        url: this.project.url,
      },
      framework: { name: 'playwright', version: this.playwrightVersion },
      env: this._envInfo(),
      startedAt: this.startedAt,
    });
    run.finishedAt = finishedAt;
    run.durationMs = Math.max(0, new Date(finishedAt).getTime() - new Date(this.startedAt).getTime());
    run.testCases = cases;
    run.totals = computeTotals(cases);

    writeFileSync(resolve(this.outputDir, 'run.json'), JSON.stringify(run, null, 2));

    // Validate what we wrote so adapter bugs surface immediately.
    const { ok, errors } = validateRun(run);
    if (!ok) {
      console.warn('[kensho] run.json failed validation:');
      for (const e of errors.slice(0, 8)) console.warn('  -', e);
    }

    console.log(`[kensho] wrote ${cases.length} cases + run.json to ${this.outputDir}`);
  }

  // ---------------- internals ----------------

  _envInfo() {
    return { ...envInfo(), commitMsg: process.env.KR_COMMIT_MSG };
  }

  _toKenshoCase(test, result) {
    const project = test.parent.project();
    const suiteChain = [];
    for (let s = test.parent; s; s = s.parent) {
      if (s.title) suiteChain.unshift(s.title);
    }
    const fullName = suiteChain.concat(test.title).join(' › ');
    const filePath = test.location?.file ? relative(process.cwd(), test.location.file) : undefined;
    // Base stable id; if another case already claimed this id (identical
    // fullName + filePath — e.g. duplicated describe blocks, parameterized
    // tests without distinct names) append a disambiguating suffix so we
    // never drop a real case.
    let id = stableCaseId(fullName, filePath);
    if (this.casesById.has(id)) {
      let i = 2;
      while (this.casesById.has(id + '_' + i)) i++;
      id = id + '_' + i;
    }
    const tags = Array.from(new Set([...(test.tags || []), ...extractInlineTags(test.title)]));

    const status = mapStatus(result?.status, test.expectedStatus);

    // Steps — flatten nested step tree, skip noisy "hooks" steps.
    const steps = (result?.steps || [])
      .filter(s => s.category === 'test.step' || s.category === 'expect' || s.category === 'pw:api')
      .map((s, i) => toKenshoStep(s, i));

    // Attachments — copy into kensho-results/attachments/<caseId>/…
    const attachments = [];
    for (const a of result?.attachments || []) {
      if (!a.path || !existsSync(a.path)) continue;
      const ext = extname(a.path).toLowerCase();
      const attId = shortId('att');
      const destDir = resolve(this.attachmentsDir, id);
      mkdirSync(destDir, { recursive: true });
      const destName = attId + '_' + basename(a.path);
      const destPath = resolve(destDir, destName);
      try { copyFileSync(a.path, destPath); } catch {}
      const stat = existsSync(destPath) ? statSync(destPath) : { size: 0 };
      attachments.push({
        id: attId,
        kind: KIND_BY_EXT[ext] || 'text',
        relativePath: relative(this.outputDir, destPath),
        mimeType: a.contentType || MIME_BY_EXT[ext] || 'application/octet-stream',
        sizeBytes: stat.size,
        sha256: fileHash(destPath),
      });
    }

    const errors = (result?.errors || []).map(e => ({
      message: String(e.message || e),
      stack: e.stack,
      type: e.name,
    }));

    return {
      id,
      name: test.title,
      fullName,
      filePath,
      line: test.location?.line,
      suite: suiteChain,
      tags,
      severity: this.severityFromTag ? severityFromTags(tags) : undefined,
      owner: pickLabel(test.annotations, 'owner'),
      labels: labelsFromAnnotations(test.annotations),
      status,
      startedAt: toIso(result?.startTime) || new Date().toISOString(),
      finishedAt: toIso(result?.startTime, result?.duration) || new Date().toISOString(),
      duration: Math.max(0, Math.round(result?.duration || 0)),
      retries: result?.retry || 0,
      retryOf: (result?.retry > 0) ? id : undefined,
      browser: project?.use?.browserName || project?.name,
      platform: process.platform,
      worker: result?.workerIndex,
      steps,
      errors: errors.length ? errors : undefined,
      attachments,
      logs: [], // Playwright doesn't surface console directly in the reporter; adapter-ext could add them
    };
  }
}

function toIso(startTime, offsetMs = 0) {
  if (startTime == null) return null;
  const base = startTime instanceof Date ? startTime.getTime()
             : typeof startTime === 'number' ? startTime
             : typeof startTime === 'string' ? Date.parse(startTime)
             : NaN;
  if (!Number.isFinite(base)) return null;
  return new Date(base + (Number.isFinite(offsetMs) ? offsetMs : 0)).toISOString();
}

function toKenshoStep(s, i, parentStart) {
  const startedAt = toIso(s.startTime) || new Date().toISOString();
  const duration = Math.max(0, Math.round(s.duration || 0));
  const status = s.error ? 'fail' : (s.duration === undefined && s.refusal ? 'skip' : 'pass');
  const step = {
    id: 'step_' + (s.stepId || i) + '_' + Math.random().toString(36).slice(2, 6),
    title: s.title || `Step ${i + 1}`,
    action: s.category,
    status,
    startedAt,
    duration,
  };
  if (s.error) {
    step.assertion = {
      expected: s.error.expected,
      received: s.error.received,
      diff: s.error.snippet,
      stack: s.error.stack,
    };
  }
  if (Array.isArray(s.steps) && s.steps.length) {
    step.children = s.steps.map((c, j) => toKenshoStep(c, j, startedAt));
  }
  return step;
}

function mapStatus(pwStatus, expected) {
  if (pwStatus === 'passed') return 'pass';
  if (pwStatus === 'failed' || pwStatus === 'timedOut') return 'fail';
  if (pwStatus === 'skipped') return 'skip';
  if (pwStatus === 'interrupted') return 'broken';
  return 'broken';
}

function extractInlineTags(title) {
  const tags = [];
  const re = /@([\w-]+)/g;
  let m;
  while ((m = re.exec(title))) tags.push(m[1]);
  return tags;
}

function pickLabel(annotations, key) {
  const a = (annotations || []).find(x => x.type === key);
  return a?.description;
}

function labelsFromAnnotations(annotations) {
  const out = {};
  for (const a of annotations || []) {
    if (!a?.type) continue;
    if (a.description) out[a.type] = String(a.description);
  }
  return Object.keys(out).length ? out : undefined;
}
