// @kaizenreport/kensho-detox — Jest reporter that knows about Detox.
//
// Detox runs on Jest under the hood, so the contract is the same as
// @kaizenreport/kensho-jest, plus it pulls device/app metadata out of the
// Detox config (`detox.device.name`, `detox.device.os`, app version) and
// auto-attaches Detox-produced screenshots/videos on failure.

import { mkdirSync, writeFileSync, existsSync, statSync, readFileSync, readdirSync, copyFileSync } from 'node:fs';
import { resolve, relative, basename } from 'node:path';
import {
  emptyRun, computeTotals, stableCaseId, validateRun,
} from '@kaizenreport/kensho-schema';
import { _bind, _drain, kensho } from './src/helpers.js';

export { kensho };

function envFromCI() {
  const isCI = !!process.env.CI;
  return {
    ci: isCI && process.env.GITHUB_ACTIONS ? 'github-actions'
      : isCI && process.env.CIRCLECI ? 'circleci'
      : isCI && process.env.GITLAB_CI ? 'gitlab'
      : isCI && process.env.JENKINS_URL ? 'jenkins'
      : isCI ? 'unknown' : 'local',
    branch: process.env.GITHUB_REF_NAME || process.env.CIRCLE_BRANCH,
    commit: process.env.GITHUB_SHA || process.env.CIRCLE_SHA1,
    os: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
  };
}

function mapStatus(jestStatus) {
  if (jestStatus === 'passed' || jestStatus === 'focused') return 'pass';
  if (jestStatus === 'failed') return 'fail';
  if (jestStatus === 'skipped' || jestStatus === 'pending' || jestStatus === 'todo' || jestStatus === 'disabled') return 'skip';
  return 'broken';
}

function detoxInfo() {
  // Detox writes runtime metadata to env vars + sometimes exposes a global.
  // We probe the typical surfaces without forcing a peer dep.
  const out = {};
  try {
    if (typeof globalThis.detox?.device?.name === 'string') out.device = globalThis.detox.device.name;
    if (typeof globalThis.detox?.device?.platform === 'string') out.platform = globalThis.detox.device.platform;
  } catch {}
  if (process.env.DETOX_DEVICE_NAME) out.device = process.env.DETOX_DEVICE_NAME;
  if (process.env.DETOX_OS_VERSION) out.osVersion = process.env.DETOX_OS_VERSION;
  if (process.env.DETOX_APP_VERSION) out.appVersion = process.env.DETOX_APP_VERSION;
  if (process.env.DETOX_CONFIGURATION) out.configuration = process.env.DETOX_CONFIGURATION;
  return out;
}

export default class KenshoDetoxReporter {
  /**
   * @param {*} globalConfig
   * @param {{ output?: string, project?: object, severityFromTag?: boolean,
   *           runId?: string, screenshotsDir?: string }} [options]
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
    // Detox writes its artifacts into `artifacts/` by default; users can
    // override via reporter option.
    this.detoxArtifactsDir = options.screenshotsDir
      ? resolve(process.cwd(), options.screenshotsDir)
      : resolve(process.cwd(), 'artifacts');

    mkdirSync(this.outputDir, { recursive: true });
    mkdirSync(this.casesDir, { recursive: true });
    mkdirSync(this.attachmentsDir, { recursive: true });

    _bind({ outputDir: this.outputDir, attachmentsRoot: this.attachmentsDir, key: null });
  }

  onTestResult(_test, testResult) {
    try {
      const filePath = testResult.testFilePath ? relative(process.cwd(), testResult.testFilePath) : undefined;
      for (const t of testResult.testResults || []) {
        const caseObj = this._toKenshoCase(t, filePath, testResult);
        writeFileSync(resolve(this.casesDir, caseObj.id + '.json'), JSON.stringify(caseObj, null, 2));
        this.casesById.set(caseObj.id, caseObj);
      }
    } catch (e) {
      console.error('[kensho] detox onTestResult failed:', e && e.message);
    }
  }

  onRunComplete(_contexts, _results) {
    const cases = [...this.casesById.values()];
    const finishedAt = new Date().toISOString();
    const env = { ...envFromCI(), ...detoxInfo() };
    const run = emptyRun({
      id: this.runId,
      project: {
        name: this.project.name || 'Unknown project',
        slug: this.project.slug || 'unknown',
        url: this.project.url,
      },
      framework: { name: 'detox', version: process.env.DETOX_VERSION || 'unknown' },
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
      console.error('[kensho] detox onRunComplete failed:', e && e.message);
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
    const startMs = (testResult?.perfStats?.start) || Date.now();
    const startedAt = new Date(startMs).toISOString();

    const errors = (t.failureMessages || []).map(m => ({
      message: String(m).split('\n')[0],
      stack: String(m),
    }));

    const buf = _drain(fullName) || { steps: [], attachments: [], labels: {}, links: [] };

    // Auto-pick up Detox screenshot/video artifacts on failure. Detox 20+
    // writes artifacts/<configuration>/<test full path>/test-failed-*.png.
    const status = mapStatus(t.status);
    const autoAttachments = [];
    if (status === 'fail') {
      const pickFrom = this._scanDetoxArtifacts(fullName);
      for (const p of pickFrom) {
        const att = this._copyAttachment(id, p);
        if (att) autoAttachments.push(att);
      }
    }

    const detox = detoxInfo();
    const labels = { ...buf.labels };
    if (detox.device) labels.device = detox.device;
    if (detox.osVersion) labels.osVersion = detox.osVersion;
    if (detox.platform) labels.platform = detox.platform;
    if (detox.configuration) labels.configuration = detox.configuration;
    if (detox.appVersion) labels.appVersion = detox.appVersion;

    return {
      id,
      name,
      fullName,
      filePath,
      line: t.location?.line,
      suite,
      tags,
      severity: this.severityFromTag ? severityFromTags(tags) : undefined,
      labels: Object.keys(labels).length ? labels : undefined,
      status,
      startedAt,
      finishedAt: new Date(startMs + duration).toISOString(),
      duration,
      retries: t.invocations ? Math.max(0, (t.invocations - 1)) : 0,
      platform: detox.platform || process.platform,
      steps: buf.steps,
      errors: errors.length ? errors : undefined,
      attachments: [...autoAttachments, ...buf.attachments],
      logs: [],
      links: buf.links.length ? buf.links : undefined,
    };
  }

  _scanDetoxArtifacts(fullName) {
    if (!existsSync(this.detoxArtifactsDir)) return [];
    const candidates = [];
    const slug = fullName.replace(/[^a-zA-Z0-9]+/g, '_');
    try {
      const stack = [this.detoxArtifactsDir];
      while (stack.length) {
        const dir = stack.pop();
        let entries;
        try { entries = readdirSyncSafe(dir); } catch { continue; }
        for (const entry of entries) {
          const full = resolve(dir, entry);
          let st;
          try { st = statSync(full); } catch { continue; }
          if (st.isDirectory()) stack.push(full);
          else if (/(test-failed|test_failed|failed).*\.(png|jpg|mp4|mov)$/i.test(entry) && full.includes(slug)) {
            candidates.push(full);
          }
        }
      }
    } catch {}
    return candidates;
  }

  _copyAttachment(caseId, srcPath) {
    if (!existsSync(srcPath)) return null;
    const ext = (srcPath.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    const kind = /\.(png|jpg|jpeg|webp)$/i.test(ext) ? 'screenshot'
      : /\.(mp4|mov|webm)$/i.test(ext) ? 'video' : 'text';
    const mime = /\.png$/i.test(ext) ? 'image/png'
      : /\.(jpg|jpeg)$/i.test(ext) ? 'image/jpeg'
      : /\.mp4$/i.test(ext) ? 'video/mp4'
      : /\.mov$/i.test(ext) ? 'video/quicktime' : 'application/octet-stream';
    const attId = 'att-' + Math.random().toString(36).slice(2, 10);
    const destDir = resolve(this.attachmentsDir, caseId);
    mkdirSync(destDir, { recursive: true });
    const destPath = resolve(destDir, attId + '_' + basename(srcPath));
    try { copyFileSync(srcPath, destPath); } catch { return null; }
    return {
      id: attId,
      kind,
      relativePath: relative(this.outputDir, destPath),
      mimeType: mime,
      sizeBytes: statSync(destPath).size,
    };
  }
}

function readdirSyncSafe(dir) { return readdirSync(dir); }

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
