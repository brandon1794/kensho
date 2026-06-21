// kensho import-allure — convert an allure-results/ directory to Kensho v1.
//
//   kensho import-allure <allure-results-dir> --out <kensho-results-dir>
//
// Allure writes one `*-result.json` per test (plus `*-container.json`,
// `*-attachment.*`, and `categories.json`/`environment.properties` we ignore).
// We parse each result file and map it onto the Kensho schema:
//
//   status        passed→pass, failed→fail, broken→broken, skipped→skip,
//                 unknown→broken
//   statusDetails {message, trace} → errors[0]{message, stack}
//   steps         recursive Allure steps → Kensho steps (children preserved)
//   labels        epic/feature/story → behavior; severity/owner promoted;
//                 tag → tags[]; suite/parentSuite/subSuite → suite[]
//   links         issue/tms/link → links[] (kind issue|tms|other)
//   parameters    → parameters[]
//   attachments   copied by basename into attachments/<caseId>/
//
// Case ids use stableCaseId(fullName, filePath) so they correlate across runs.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, copyFileSync, statSync } from 'node:fs';
import { join, resolve, basename, extname } from 'node:path';
import { validateRun, computeTotals, stableCaseId, emptyRun } from '@kaizenreport/kensho-schema';

const STATUS_MAP = {
  passed: 'pass',
  failed: 'fail',
  broken: 'broken',
  skipped: 'skip',
  unknown: 'broken',
};
const STEP_STATUS_MAP = {
  passed: 'pass',
  failed: 'fail',
  broken: 'fail',          // Kensho step status has no 'broken'
  skipped: 'skip',
  unknown: 'fail',
};

// Allure mime/kind → Kensho attachment kind (best-effort).
function kindForAttachment(att) {
  const t = (att.type || '').toLowerCase();
  const name = (att.source || att.name || '').toLowerCase();
  if (t.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/.test(name)) return 'screenshot';
  if (t.startsWith('video/') || /\.(mp4|webm|mov)$/.test(name)) return 'video';
  if (t.includes('json') || name.endsWith('.json')) return 'json';
  if (t.includes('html') || name.endsWith('.html')) return 'html';
  if (name.endsWith('.har')) return 'har';
  if (name.endsWith('.zip') || name.includes('trace')) return 'trace';
  return 'text';
}
function mimeForAttachment(att) {
  if (att.type) return att.type;
  const ext = extname(att.source || att.name || '').toLowerCase();
  const m = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm',
    '.json': 'application/json', '.html': 'text/html', '.txt': 'text/plain',
    '.har': 'application/json', '.zip': 'application/zip',
  };
  return m[ext] || 'application/octet-stream';
}

let stepSeq = 0;
function mapStep(s, caseId, srcDir, outAttDir, collectedAtt) {
  const id = `step_${++stepSeq}`;
  const out = {
    id,
    title: s.name || 'step',
    status: STEP_STATUS_MAP[s.status] || 'pass',
    startedAt: s.start ? new Date(s.start).toISOString() : new Date(0).toISOString(),
    duration: s.start && s.stop ? Math.max(0, s.stop - s.start) : 0,
  };
  if (s.statusDetails?.message || s.statusDetails?.trace) {
    out.logs = [{ t: 0, level: 'error', msg: s.statusDetails.message || s.statusDetails.trace }];
  }
  if (Array.isArray(s.parameters) && s.parameters.length) {
    out.parameters = s.parameters.map(p => ({ name: String(p.name ?? ''), value: String(p.value ?? '') }));
  }
  if (Array.isArray(s.attachments) && s.attachments.length) {
    out.attachments = s.attachments
      .map(a => copyAttachment(a, caseId, srcDir, outAttDir, collectedAtt))
      .filter(Boolean);
  }
  if (Array.isArray(s.steps) && s.steps.length) {
    out.children = s.steps.map(cs => mapStep(cs, caseId, srcDir, outAttDir, collectedAtt));
  }
  return out;
}

let attSeq = 0;
// Copy an Allure attachment by basename (strips any directory component) into
// attachments/<caseId>/. Returns a Kensho attachment record, or null.
function copyAttachment(a, caseId, srcDir, outAttDir, collected) {
  if (!a || !a.source) return null;
  const safeBase = basename(String(a.source));   // strip dirs / traversal
  if (!safeBase || safeBase === '.' || safeBase === '..') return null;
  const from = join(srcDir, safeBase);
  if (!existsSync(from)) return null;
  let st;
  try { st = statSync(from); } catch { return null; }
  if (!st.isFile()) return null;
  const destDir = join(outAttDir, caseId);
  mkdirSync(destDir, { recursive: true });
  copyFileSync(from, join(destDir, safeBase));
  collected.add(safeBase);
  return {
    id: `att_${++attSeq}`,
    kind: kindForAttachment(a),
    relativePath: `attachments/${caseId}/${safeBase}`,
    mimeType: mimeForAttachment(a),
    sizeBytes: st.size,
    name: a.name || safeBase,
  };
}

function labelValues(labels, name) {
  return (labels || []).filter(l => l.name === name).map(l => l.value).filter(Boolean);
}
function firstLabel(labels, name) {
  return labelValues(labels, name)[0];
}

function mapResult(r, srcDir, outAttDir) {
  const fullName = r.fullName || r.name || 'unnamed';
  // Allure carries the source file in a testClass / suite-ish way; prefer an
  // explicit filePath param, else the parentSuite label, else nothing.
  const filePath = firstLabel(r.labels, 'path') ||
    (r.parameters || []).find(p => /file|path/i.test(p.name || ''))?.value ||
    undefined;
  const id = stableCaseId(fullName, filePath);
  const collected = new Set();

  const c = {
    id,
    name: r.name || fullName,
    fullName,
    status: STATUS_MAP[r.status] || 'broken',
    startedAt: r.start ? new Date(r.start).toISOString() : new Date(0).toISOString(),
    duration: r.start && r.stop ? Math.max(0, r.stop - r.start) : 0,
  };
  if (r.stop) c.finishedAt = new Date(r.stop).toISOString();
  if (filePath) c.filePath = filePath;
  if (r.description) c.description = r.description;

  // errors from statusDetails
  if (r.statusDetails && (r.statusDetails.message || r.statusDetails.trace)) {
    c.errors = [{
      message: r.statusDetails.message || '',
      stack: r.statusDetails.trace || undefined,
    }];
  }

  // severity / owner
  const sev = firstLabel(r.labels, 'severity');
  if (sev && ['blocker', 'critical', 'normal', 'minor', 'trivial'].includes(sev)) c.severity = sev;
  const owner = firstLabel(r.labels, 'owner');
  if (owner) c.owner = owner;

  // tags
  const tags = labelValues(r.labels, 'tag');
  if (tags.length) c.tags = tags;

  // suite hierarchy → suite[]
  const suite = [
    firstLabel(r.labels, 'parentSuite'),
    firstLabel(r.labels, 'suite'),
    firstLabel(r.labels, 'subSuite'),
  ].filter(Boolean);
  if (suite.length) c.suite = suite;

  // behavior: epic / feature / story
  const epic = firstLabel(r.labels, 'epic');
  const feature = firstLabel(r.labels, 'feature');
  const story = firstLabel(r.labels, 'story');
  if (epic || feature || story) {
    c.behavior = {};
    if (epic) c.behavior.epic = epic;
    if (feature) c.behavior.feature = feature;
    if (story) c.behavior.scenario = story;
  }

  // links: issue / tms / link
  if (Array.isArray(r.links) && r.links.length) {
    c.links = r.links.map(l => ({
      url: l.url || '',
      kind: l.type === 'issue' ? 'issue' : l.type === 'tms' ? 'tms' : 'other',
      label: l.name || undefined,
    })).filter(l => l.url);
  }

  // parameters
  if (Array.isArray(r.parameters) && r.parameters.length) {
    c.parameters = r.parameters.map(p => ({
      name: String(p.name ?? ''),
      value: String(p.value ?? ''),
    }));
  }

  // steps (recursive)
  if (Array.isArray(r.steps) && r.steps.length) {
    c.steps = r.steps.map(s => mapStep(s, id, srcDir, outAttDir, collected));
  }

  // case-level attachments
  if (Array.isArray(r.attachments) && r.attachments.length) {
    const atts = r.attachments
      .map(a => copyAttachment(a, id, srcDir, outAttDir, collected))
      .filter(Boolean);
    if (atts.length) c.attachments = atts;
  }

  return c;
}

export async function importAllure({ input, out }) {
  const srcDir = resolve(input);
  if (!existsSync(srcDir)) throw new Error(`allure-results dir not found: ${srcDir}`);
  if (!out) throw new Error('import-allure requires --out <dir>');
  const outDir = resolve(out);

  const resultFiles = readdirSync(srcDir).filter(f => f.endsWith('-result.json'));
  if (!resultFiles.length) {
    throw new Error(`no *-result.json files found in ${srcDir}`);
  }

  mkdirSync(outDir, { recursive: true });
  const outCases = join(outDir, 'cases');
  mkdirSync(outCases, { recursive: true });
  const outAtt = join(outDir, 'attachments');

  let starts = [];
  let stops = [];
  const cases = [];
  const byId = new Map();          // dedupe (Allure retries → same id)
  for (const f of resultFiles) {
    let r;
    try { r = JSON.parse(readFileSync(join(srcDir, f), 'utf8')); }
    catch (e) { console.warn(`[kensho] skipping ${f}: ${e.message}`); continue; }
    const c = mapResult(r, srcDir, outAtt);
    if (r.start) starts.push(r.start);
    if (r.stop) stops.push(r.stop);
    // Last write wins for a repeated id (latest result file).
    byId.set(c.id, c);
  }
  for (const c of byId.values()) cases.push(c);

  const startedAt = starts.length ? new Date(Math.min(...starts)).toISOString() : new Date().toISOString();
  const finishedAt = stops.length ? new Date(Math.max(...stops)).toISOString() : startedAt;

  const run = emptyRun({
    project: { name: 'Imported (Allure)', slug: 'allure-import' },
    framework: { name: 'junit-xml', version: '0.0.0' },
    startedAt,
  });
  run.framework = { name: 'junit-xml', version: '0.0.0' };
  run.finishedAt = finishedAt;
  run.durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
  run.testCases = cases;
  run.totals = computeTotals(cases);

  for (const c of cases) {
    writeFileSync(join(outCases, c.id + '.json'), JSON.stringify(c, null, 2));
  }
  writeFileSync(join(outDir, 'run.json'), JSON.stringify(run, null, 2));

  const { ok, errors } = validateRun(run);
  const t = run.totals;
  console.log(`[kensho] ✓ imported ${cases.length} Allure result${cases.length === 1 ? '' : 's'} · pass ${t.pass} · fail ${t.fail} · broken ${t.broken} · skip ${t.skip}`);
  console.log(`[kensho] ✓ written to ${outDir}/`);
  if (!ok) {
    console.warn(`[kensho] ⚠ imported run has ${errors.length} validation issue(s):`);
    for (const e of errors.slice(0, 8)) console.warn('  -', e);
    return 1;
  }
  return 0;
}
