// @kaizenreport/kensho-xcuitest — convert an .xcresult bundle into kensho-results/.
//
// xcresulttool emits a deeply-nested JSON tree. We walk:
//   actions[] → actionResult.testsRef → ActionTestPlanRunSummaries
//     summaries[].testableSummaries[].tests[] (recursive ActionTestSummaryGroup)
//       → leaves are ActionTestSummary objects with status/duration/activitySummaries[]
// activitySummaries[] are recursive too — each becomes a Kensho step.
//
// We support two modes:
//   1) `--input some.xcresult` — calls `xcrun xcresulttool` to extract JSON. macOS only.
//   2) `--input some.json`     — reads a pre-extracted JSON tree (used in the demo
//                                fixture and in CI on non-mac machines).

import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, copyFileSync } from 'node:fs';
import { resolve, basename, extname, relative } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { emptyRun, computeTotals, stableCaseId, validateRun } from '@kaizenreport/kensho-schema';

function shortId(prefix) { return prefix + '-' + Math.random().toString(36).slice(2, 10); }

function envInfo() {
  const isCI = !!process.env.CI;
  return {
    ci: isCI && process.env.GITHUB_ACTIONS ? 'github-actions'
      : isCI && process.env.CIRCLECI ? 'circleci'
      : isCI && process.env.GITLAB_CI ? 'gitlab'
      : isCI && process.env.JENKINS_URL ? 'jenkins'
      : isCI ? 'unknown' : 'local',
    branch: process.env.GITHUB_REF_NAME || process.env.CIRCLE_BRANCH,
    commit: process.env.GITHUB_SHA || process.env.CIRCLE_SHA1,
    os: 'darwin',
    nodeVersion: process.version,
    appVersion: process.env.APP_VERSION,
  };
}

// xcresulttool wraps every value in { _type: { _name }, _value }, or for arrays,
// { _values: [...] }. These helpers strip that ceremony so we can walk a normal tree.
export function unwrap(node) {
  if (node == null) return node;
  if (typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(unwrap);
  if ('_value' in node && Object.keys(node).length <= 2) return unwrap(node._value);
  if ('_values' in node && Array.isArray(node._values)) return node._values.map(unwrap);
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === '_type') continue;
    out[k] = unwrap(v);
  }
  return out;
}

const STATUS_MAP = {
  Success: 'pass',
  Failure: 'fail',
  Expected: 'pass',
  ExpectedFailure: 'broken',
  Skipped: 'skip',
};

function mapStatus(s) {
  if (!s) return 'broken';
  const k = String(s);
  return STATUS_MAP[k] || (/^(skip)/i.test(k) ? 'skip' : /^(fail)/i.test(k) ? 'fail' : /^(pass|success)/i.test(k) ? 'pass' : 'broken');
}

/**
 * Run `xcrun xcresulttool get --format json` to extract a JSON tree from an .xcresult
 * bundle. macOS + Xcode CLT required. Returns the parsed object.
 */
export function readXcresult(bundlePath, { id } = {}) {
  const args = ['xcresulttool', 'get', '--format', 'json', '--path', bundlePath];
  if (id) args.push('--id', id);
  const buf = execFileSync('xcrun', args, { maxBuffer: 256 * 1024 * 1024 });
  return JSON.parse(buf.toString('utf8'));
}

/**
 * Try to extract a per-test detailed summary from an .xcresult bundle. Falls
 * back to whatever's already inlined in the top-level summary if xcresulttool
 * isn't reachable (non-mac CI runner, etc.).
 */
function tryReadTestSummary(bundlePath, summaryRefId) {
  if (!bundlePath || !summaryRefId) return null;
  const r = spawnSync('xcrun', ['xcresulttool', 'get', '--format', 'json', '--path', bundlePath, '--id', summaryRefId], { maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) return null;
  try { return unwrap(JSON.parse(r.stdout.toString('utf8'))); } catch { return null; }
}

function activityToStep(act, baseEpochMs, attachmentsCb) {
  const startMs = act.start != null ? Date.parse(act.start) : (baseEpochMs || Date.now());
  const duration = Math.max(0, Math.round((act.duration || 0) * 1000)) || 0;
  const step = {
    id: shortId('step'),
    title: act.title || act.activityType || 'activity',
    action: act.activityType,
    status: act.failureSummaryIDs && act.failureSummaryIDs.length ? 'fail' : 'pass',
    startedAt: new Date(startMs).toISOString(),
    duration,
  };
  const atts = [];
  for (const a of act.attachments || []) {
    if (typeof attachmentsCb === 'function') {
      const att = attachmentsCb(a);
      if (att) atts.push(att);
    }
  }
  if (atts.length) step.attachments = atts;
  if (Array.isArray(act.subactivities) && act.subactivities.length) {
    step.children = act.subactivities.map(s => activityToStep(s, startMs, attachmentsCb));
  }
  return step;
}

function walkTests(node, suiteChain, leaves) {
  if (!node) return;
  // ActionTestSummaryGroup: has subtests; ActionTestSummary: has identifier+testStatus
  if (node.subtests) {
    const next = node.name ? [...suiteChain, node.name] : suiteChain;
    for (const t of node.subtests) walkTests(t, next, leaves);
    return;
  }
  if (Array.isArray(node)) {
    for (const t of node) walkTests(t, suiteChain, leaves);
    return;
  }
  if (node.identifier || node.identifierURL || node.testStatus) {
    leaves.push({ test: node, suite: suiteChain });
  }
}

function copyAttachmentToBundle({ a, attachmentsDir, caseId, bundlePath, outputDir }) {
  const filename = a.filename || a.name || 'attachment';
  const ext = extname(filename).toLowerCase();
  const kind = ext === '.png' || ext === '.jpg' || ext === '.jpeg' ? 'screenshot'
    : ext === '.mp4' || ext === '.mov' ? 'video'
    : ext === '.txt' || ext === '.log' ? 'log'
    : ext === '.json' ? 'json' : 'text';
  const mime = ext === '.png' ? 'image/png'
    : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : ext === '.mp4' ? 'video/mp4' : ext === '.mov' ? 'video/quicktime'
    : ext === '.json' ? 'application/json' : 'text/plain';
  const refId = a.payloadRef && (a.payloadRef.id || a.payloadRef);
  const attId = shortId('att');
  const destDir = resolve(attachmentsDir, caseId);
  mkdirSync(destDir, { recursive: true });
  const destPath = resolve(destDir, attId + '_' + filename);
  let sz = 0;

  if (refId && bundlePath) {
    const r = spawnSync('xcrun', ['xcresulttool', 'export', '--type', 'file', '--path', bundlePath, '--id', refId, '--output-path', destPath]);
    if (r.status === 0 && existsSync(destPath)) sz = statSync(destPath).size;
  }
  if (!sz && a.localPath && existsSync(a.localPath)) {
    try { copyFileSync(a.localPath, destPath); sz = statSync(destPath).size; } catch {}
  }
  if (!sz) {
    // Synthesise a placeholder so the case still references something; fixtures
    // exercise this path because they don't ship the binary blob.
    writeFileSync(destPath, `[xcresult attachment placeholder for ${filename}]`);
    sz = statSync(destPath).size;
  }
  return {
    id: attId,
    kind,
    relativePath: relative(outputDir, destPath),
    mimeType: mime,
    sizeBytes: sz,
  };
}

/**
 * Convert an xcresulttool JSON tree (already loaded) into kensho-results/.
 */
export function convertParsed(parsed, { outputDir, project, runId, bundlePath } = {}) {
  const outDir = resolve(process.cwd(), outputDir || 'kensho-results');
  const casesDir = resolve(outDir, 'cases');
  const attachmentsDir = resolve(outDir, 'attachments');
  mkdirSync(outDir, { recursive: true });
  mkdirSync(casesDir, { recursive: true });
  mkdirSync(attachmentsDir, { recursive: true });

  const root = unwrap(parsed);
  const startedAt = root.metadataRef?.creatingWorkspaceFilePath || new Date().toISOString();
  const runStarted = root.startedTime || new Date().toISOString();
  const runFinished = root.endedTime || new Date().toISOString();

  const actions = root.actions || [];
  const testRefs = [];
  for (const a of actions) {
    const ref = a.actionResult?.testsRef?.id;
    if (ref) testRefs.push(ref);
    if (a.testPlanRunSummaries) testRefs.push(a.testPlanRunSummaries);
  }

  // The fixture path inlines `testPlanRunSummaries` directly. Real bundles
  // reference it by id and we have to fetch via xcresulttool.
  const summaryTrees = [];
  for (const a of actions) {
    if (a.testPlanRunSummaries) summaryTrees.push(a.testPlanRunSummaries);
    else if (a.actionResult?.testsRef?.id && bundlePath) {
      const sub = tryReadTestSummary(bundlePath, a.actionResult.testsRef.id);
      if (sub) summaryTrees.push(sub);
    }
  }

  const usedIds = new Set();
  const cases = [];

  for (const tree of summaryTrees) {
    const summaries = tree.summaries || [];
    for (const s of summaries) {
      const testables = s.testableSummaries || [];
      for (const ts of testables) {
        const targetName = ts.name || ts.targetName;
        const targetSuite = targetName ? [targetName] : [];
        const leaves = [];
        for (const t of ts.tests || []) walkTests(t, targetSuite, leaves);
        for (const { test, suite } of leaves) {
          const c = caseFromTest(test, suite, ts, { usedIds, bundlePath, outputDir: outDir, casesDir, attachmentsDir });
          writeFileSync(resolve(casesDir, c.id + '.json'), JSON.stringify(c, null, 2));
          cases.push(c);
        }
      }
    }
  }

  const env = envInfo();
  // Promote device caps from the destination metadata if present.
  for (const a of actions) {
    const dest = a.runDestination;
    if (dest) {
      if (dest.targetDeviceRecord?.modelName) env.device = String(dest.targetDeviceRecord.modelName);
      if (dest.targetDeviceRecord?.operatingSystemVersion) env.osVersion = String(dest.targetDeviceRecord.operatingSystemVersion);
      if (dest.targetSDKRecord?.name) env.platform = String(dest.targetSDKRecord.name);
    }
  }

  const run = emptyRun({
    id: runId || ('run_' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)),
    project: {
      name: project?.name || 'Unknown project',
      slug: project?.slug || 'unknown',
      url: project?.url,
    },
    framework: { name: 'xcuitest', version: root.creatingWorkspaceFilePath ? 'xcode' : 'xcresulttool' },
    env,
    startedAt: typeof runStarted === 'string' ? runStarted : new Date(runStarted).toISOString(),
  });
  run.finishedAt = typeof runFinished === 'string' ? runFinished : new Date(runFinished).toISOString();
  run.durationMs = Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt));
  run.testCases = cases;
  run.totals = computeTotals(cases);

  writeFileSync(resolve(outDir, 'run.json'), JSON.stringify(run, null, 2));
  const { ok, errors } = validateRun(run);
  if (!ok) {
    console.warn('[kensho] run.json failed validation:');
    for (const e of errors.slice(0, 8)) console.warn('  -', e);
  }
  console.log(`[kensho] wrote ${cases.length} cases + run.json to ${outDir}`);
  return { outputDir: outDir, cases: cases.length, ok };
}

function caseFromTest(test, suite, testable, ctx) {
  const name = test.name || test.identifier || 'unnamed';
  const fullName = [...suite, name].join(' › ');
  const filePath = test.documentLocationInCreatingWorkspace?.url
    ? String(test.documentLocationInCreatingWorkspace.url).replace(/^file:\/\//, '').split('#')[0]
    : (testable?.targetName ? testable.targetName : undefined);
  const line = parseLineFromUrl(test.documentLocationInCreatingWorkspace?.url);

  let id = stableCaseId(fullName, filePath);
  if (ctx.usedIds.has(id)) {
    let i = 2;
    while (ctx.usedIds.has(id + '_' + i)) i++;
    id = id + '_' + i;
  }
  ctx.usedIds.add(id);

  const status = mapStatus(test.testStatus);
  const duration = Math.max(0, Math.round((test.duration || 0) * 1000));
  const startMs = Date.now() - duration;
  const startedAt = new Date(startMs).toISOString();
  const finishedAt = new Date(startMs + duration).toISOString();

  const attachmentsCb = (a) => copyAttachmentToBundle({
    a,
    attachmentsDir: ctx.attachmentsDir,
    caseId: id,
    bundlePath: ctx.bundlePath,
    outputDir: ctx.outputDir,
  });

  const steps = (test.activitySummaries || []).map(act => activityToStep(act, startMs, attachmentsCb));

  // Top-level attachments (some xcresult bundles surface them outside activities).
  const attachments = [];
  for (const a of test.attachments || []) {
    const att = attachmentsCb(a);
    if (att) attachments.push(att);
  }

  const errors = (test.failureSummaries || []).map(f => ({
    message: f.message || f.issueType || 'failure',
    type: f.issueType,
    stack: [f.fileName, f.lineNumber].filter(Boolean).join(':'),
  }));

  const labels = {};
  if (testable?.targetName) labels.target = String(testable.targetName);
  if (testable?.identifierURL) labels.testTarget = String(testable.identifierURL);

  return {
    id,
    name,
    fullName,
    filePath,
    line,
    suite,
    tags: [],
    labels: Object.keys(labels).length ? labels : undefined,
    status,
    startedAt,
    finishedAt,
    duration,
    retries: 0,
    platform: 'iOS',
    steps,
    errors: errors.length ? errors : undefined,
    attachments,
    logs: [],
  };
}

function parseLineFromUrl(url) {
  if (!url) return undefined;
  const m = /#.*?StartingLineNumber=(\d+)/.exec(url);
  return m ? parseInt(m[1], 10) : undefined;
}

/**
 * High-level entrypoint used by the CLI.
 *
 * @param {{ input: string, output?: string, project?: object, runId?: string }} opts
 */
export function convert({ input, output, project, runId }) {
  const inputPath = resolve(process.cwd(), input);
  if (!existsSync(inputPath)) throw new Error(`input not found: ${inputPath}`);

  let parsed;
  let bundlePath;
  if (statSync(inputPath).isDirectory()) {
    bundlePath = inputPath;
    parsed = readXcresult(inputPath);
  } else {
    parsed = JSON.parse(readFileSync(inputPath, 'utf8'));
  }
  return convertParsed(parsed, { outputDir: output, project, runId, bundlePath });
}
