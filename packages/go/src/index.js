// @kaizenreport/kensho-go — convert `go test -json` output into a
// kensho-results/ bundle. Pure stdlib JS, no deps beyond the schema.
//
// `go test -json` emits one JSON object per line, with these Actions we care
// about:
//
//   run     — a test (or sub-test) started.
//   output  — captured stdout/stderr line for that test.
//   pass    — the test finished successfully.
//   fail    — the test finished with at least one assertion failure or panic.
//   skip    — the test was skipped (t.Skip / build-tag).
//   pause / cont — t.Parallel sequencing; we ignore for case timing.
//
// We bucket events by (Package, Test). Top-level tests become Kensho cases.
// Sub-tests created with `t.Run("sub", ...)` become children of their parent;
// by default each sub-test is its own Kensho case (so the dashboard sees the
// full table-driven matrix), but the caller can opt into folding them into
// child steps with `--subtests=children`.
//
// A test that emits a Go panic (`panic:` in its captured output) is mapped
// to Kensho `fail` — Go's std test runner has no `broken` concept, so the
// schema's "infrastructure failure" bucket is reserved for things like
// missing input files at the converter layer.
//
// Helper hooks: tests using the optional `kensho` Go module write structured
// records via t.Logf as `KENSHO_META: <json>` lines. We parse those out so
// users get first-class steps, attachments, labels and links matching the
// other adapters.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { resolve, basename, extname, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { emptyRun, computeTotals, stableCaseId, validateRun, envInfo } from '@kaizenreport/kensho-schema';

const SEVERITY_NAMES = ['blocker', 'critical', 'normal', 'minor', 'trivial'];

const MIME_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.webm': 'video/webm', '.mp4': 'video/mp4',
  '.zip': 'application/zip', '.html': 'text/html',
  '.json': 'application/json', '.txt': 'text/plain', '.log': 'text/plain',
  '.har': 'application/json',
};

const KIND_BY_EXT = {
  '.png': 'screenshot', '.jpg': 'screenshot', '.jpeg': 'screenshot', '.webp': 'screenshot',
  '.webm': 'video', '.mp4': 'video',
  '.zip': 'trace',
  '.html': 'html', '.json': 'json', '.txt': 'text', '.log': 'log',
  '.har': 'har',
};

// envInfo() is imported from @kaizenreport/kensho-schema below.

// --- input ingestion ---------------------------------------------------------

function parseLines(text) {
  const events = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line[0] !== '{') continue; // tolerate stray tool output before/after the stream
    try {
      events.push(JSON.parse(line));
    } catch {
      // Ignore malformed lines — `go test -json` very occasionally emits build
      // diagnostics on stderr that get tee'd in.
    }
  }
  return events;
}

export function readEvents(input) {
  if (input == null) return [];
  if (Array.isArray(input)) return input.flatMap(p => parseLines(readFileSync(p, 'utf8')));
  return parseLines(readFileSync(input, 'utf8'));
}

export async function readEventsFromStream(stream) {
  return new Promise((res, rej) => {
    const chunks = [];
    stream.on('data', c => chunks.push(c));
    stream.on('end', () => res(parseLines(Buffer.concat(chunks).toString('utf8'))));
    stream.on('error', rej);
  });
}

// --- helper meta protocol ----------------------------------------------------
//
// The optional Go helper writes `KENSHO_META: <json>` lines via t.Logf.
// Each meta record carries a `kind` so we know how to fold it into the case.
// Recognised kinds:
//
//   step_start    { id, title, action?, parent?, t }
//   step_end      { id, status, t }
//   attach        { name, path, kind?, mimeType?, stepId? }
//   label         { key, value }
//   link          { url, kind?, label? }
//   severity      { value }
//   tag           { value }
//   feature/epic/scenario  { value }
//   parameter     { name, value, kind? }

const META_PREFIX = 'KENSHO_META:';

function parseMeta(line) {
  const idx = line.indexOf(META_PREFIX);
  if (idx < 0) return null;
  const json = line.slice(idx + META_PREFIX.length).trim();
  if (!json.startsWith('{')) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// --- core conversion ---------------------------------------------------------

function severityFromName(name) {
  // Recognise the conventions documented in the README:
  //   Test_blocker_*, Test_critical_*, Test_normal_*, Test_minor_*, Test_trivial_*
  //   …or sub-tests named e.g. "severity:critical" / "@critical".
  const lower = String(name || '').toLowerCase();
  for (const sev of SEVERITY_NAMES) {
    if (new RegExp(`(?:^|[^a-z])${sev}(?:$|[^a-z])`).test(lower)) return sev;
  }
  return undefined;
}

function extractTags(name) {
  const tags = [];
  const re = /@([\w-]+)/g;
  let m;
  while ((m = re.exec(String(name || '')))) tags.push(m[1]);
  return tags;
}

function packagePathToFile(pkg, file) {
  // `Package` is the import path (e.g. github.com/foo/bar/internal). When the
  // helper meta isn't present we don't know the precise file, so we synthesise
  // a stable path from the import path so stableCaseId is consistent across
  // runs without coupling to the user's $GOPATH.
  if (file) return file;
  if (!pkg) return undefined;
  return pkg.split('/').join('/') + '/*_test.go';
}

function safeIso(t) {
  if (!t) return undefined;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

function splitTestPath(test) {
  // Go convention: parent test and sub-tests joined by "/"
  return String(test || '').split('/');
}

function fileHash(p) {
  try {
    const h = createHash('sha256');
    h.update(statSync(p).size + ':' + p);
    return h.digest('hex').slice(0, 16);
  } catch { return undefined; }
}

function shortId(prefix) {
  return prefix + '_' + randomUUID().replace(/-/g, '').slice(0, 10);
}

/**
 * Convert a stream of `go test -json` events into a kensho-results/ bundle.
 *
 * @param {{
 *   events: object[],
 *   output: string,
 *   project?: { name?: string, slug?: string, url?: string },
 *   runId?: string,
 *   subtests?: 'cases' | 'children',
 * }} opts
 */
export function convertGoEvents(opts) {
  const events = opts.events || [];
  const outDir = resolve(process.cwd(), opts.output || 'kensho-results');
  const casesDir = resolve(outDir, 'cases');
  const attachmentsDir = resolve(outDir, 'attachments');
  mkdirSync(outDir, { recursive: true });
  mkdirSync(casesDir, { recursive: true });
  mkdirSync(attachmentsDir, { recursive: true });

  const subtests = opts.subtests === 'children' ? 'children' : 'cases';
  const startedAt = new Date().toISOString();

  // Two-pass: first build per-(pkg,test) buckets, then flatten into cases
  // honoring the sub-test mode.
  /** @type {Map<string, {
   *   pkg: string,
   *   test: string,
   *   parts: string[],
   *   startedAt?: string,
   *   finishedAt?: string,
   *   elapsed?: number,
   *   status?: string,
   *   panic?: boolean,
   *   output: string[],
   *   meta: object[],
   *   parentKey?: string,
   * }>} */
  const buckets = new Map();
  const orderedKeys = [];

  const keyFor = (pkg, test) => `${pkg}::${test}`;

  for (const ev of events) {
    if (!ev || !ev.Action) continue;
    if (!ev.Test) continue; // package-level pass/fail/output — ignore for case building
    const key = keyFor(ev.Package || '', ev.Test);
    let b = buckets.get(key);
    if (!b) {
      const parts = splitTestPath(ev.Test);
      const parentKey = parts.length > 1 ? keyFor(ev.Package || '', parts.slice(0, -1).join('/')) : undefined;
      b = {
        pkg: ev.Package || '',
        test: ev.Test,
        parts,
        output: [],
        meta: [],
        parentKey,
      };
      buckets.set(key, b);
      orderedKeys.push(key);
    }
    switch (ev.Action) {
      case 'run':
        b.startedAt = safeIso(ev.Time) || b.startedAt;
        break;
      case 'output': {
        const txt = String(ev.Output || '');
        const meta = parseMeta(txt);
        if (meta) b.meta.push(meta);
        else if (txt.length) b.output.push(txt.replace(/\n$/, ''));
        if (/^\s*panic:/m.test(txt)) b.panic = true;
        break;
      }
      case 'pass':
      case 'fail':
      case 'skip':
        b.status = ev.Action;
        b.finishedAt = safeIso(ev.Time) || b.finishedAt;
        if (typeof ev.Elapsed === 'number') b.elapsed = ev.Elapsed;
        break;
      // pause / cont / bench — ignored
    }
  }

  const usedIds = new Set();
  /** @type {object[]} */
  const cases = [];

  for (const key of orderedKeys) {
    const b = buckets.get(key);
    if (!b) continue;
    const isSub = b.parts.length > 1;
    if (subtests === 'children' && isSub) continue; // handled by the parent

    const caseObj = bucketToCase(b, buckets, subtests, usedIds);
    // Materialise attachments declared via meta into the on-disk attachments
    // dir so the bundle is self-contained — must happen before we write the
    // case JSON so the attachment records are present.
    materialiseAttachments(caseObj, attachmentsDir, outDir);
    cases.push(caseObj);
    writeFileSync(resolve(casesDir, caseObj.id + '.json'), JSON.stringify(caseObj, null, 2));
  }

  const finishedAt = new Date().toISOString();
  const run = emptyRun({
    id: opts.runId || ('run_' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)),
    project: {
      name: opts.project?.name || 'Unknown project',
      slug: opts.project?.slug || 'unknown',
      url: opts.project?.url,
    },
    framework: { name: 'go-test', version: '0.1.0' },
    env: envInfo(),
    startedAt,
  });
  run.finishedAt = finishedAt;
  run.durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
  run.testCases = cases;
  run.totals = computeTotals(cases);

  writeFileSync(resolve(outDir, 'run.json'), JSON.stringify(run, null, 2));
  const { ok, errors } = validateRun(run);
  if (!ok) {
    console.warn('[kensho-go] run.json failed validation:');
    for (const e of errors.slice(0, 8)) console.warn('  -', e);
  }
  console.log(`[kensho-go] wrote ${cases.length} cases + run.json to ${outDir}`);
  return { outputDir: outDir, cases: cases.length, valid: ok };
}

function bucketToCase(b, buckets, subtests, usedIds) {
  const fullName = `${b.pkg}::${b.test}`;
  const filePath = packagePathToFile(b.pkg);
  let id = stableCaseId(fullName, filePath);
  if (usedIds.has(id)) {
    let i = 2;
    while (usedIds.has(id + '_' + i)) i++;
    id = id + '_' + i;
  }
  usedIds.add(id);

  const suite = b.pkg ? b.pkg.split('/').filter(Boolean) : [];
  // Strip a leading '@' from any tag (helper users and sub-test names both use
  // the `@tag` convention) and de-duplicate.
  const tags = Array.from(new Set(
    [...extractTags(b.test), ...metaTags(b.meta)]
      .map(s => String(s).replace(/^@+/, ''))
      .filter(Boolean)
  ));

  const status = mapStatus(b);
  const startedAt = b.startedAt || new Date().toISOString();
  const duration = Math.max(0, Math.round((b.elapsed || 0) * 1000));
  const finishedAt = b.finishedAt || new Date(Date.parse(startedAt) + duration).toISOString();

  const errors = collectErrors(b);
  const logs = collectLogs(b, startedAt);
  const labels = metaLabels(b.meta);
  const links = metaLinks(b.meta);
  const parameters = metaParameters(b.meta);
  const behavior = metaBehavior(b.meta);
  const severity = metaSeverity(b.meta) || severityFromName(lastPart(b.test));
  const owner = metaScalar(b.meta, 'owner');
  const description = metaScalar(b.meta, 'description');
  const flaky = b.meta.some(m => m && m.kind === 'flaky');
  const muted = b.meta.some(m => m && m.kind === 'muted');

  // Mirror epic/feature/story into labels so consumers that key off labels
  // (the platform's behavior grouping) pick them up alongside behavior{}.
  // `story` is sourced from the story/scenario meta that fed behavior.scenario.
  const story = metaStory(b.meta);
  if (behavior.epic && labels.epic == null) labels.epic = behavior.epic;
  if (behavior.feature && labels.feature == null) labels.feature = behavior.feature;
  if (story && labels.story == null) labels.story = story;

  let steps = metaSteps(b.meta);

  // Collect attach meta — the actual file copy happens in
  // materialiseAttachments after the case object is in hand.
  const attachMeta = b.meta.filter(m => m && m.kind === 'attach' && m.path);

  // When sub-tests are folded into children, build a synthetic step tree
  // from each sub-bucket and append it to this case's `steps`.
  if (subtests === 'children') {
    const childKeys = Array.from(buckets.keys()).filter(k => {
      const cb = buckets.get(k);
      return cb && cb.parentKey === keyFor(b.pkg, b.test) && cb.parts.length === b.parts.length + 1;
    });
    childKeys.sort();
    for (const childKey of childKeys) {
      const cb = buckets.get(childKey);
      const childStep = subBucketToStep(cb, buckets, b.startedAt || startedAt);
      if (childStep) steps.push(childStep);
    }
  }

  const caseObj = {
    id,
    name: lastPart(b.test),
    fullName,
    filePath,
    suite,
    tags,
    status,
    startedAt,
    finishedAt,
    duration,
    retries: 0,
    platform: process.platform,
  };
  if (severity) caseObj.severity = severity;
  if (owner) caseObj.owner = owner;
  if (description) caseObj.description = description;
  if (flaky) caseObj.flaky = true;
  if (muted) caseObj.muted = true;
  if (Object.keys(behavior).length) caseObj.behavior = behavior;
  if (Object.keys(labels).length) caseObj.labels = labels;
  if (links.length) caseObj.links = links;
  if (parameters.length) caseObj.parameters = parameters;
  if (steps.length) caseObj.steps = steps;
  if (errors.length) caseObj.errors = errors;
  if (logs.length) caseObj.logs = logs;
  if (attachMeta.length) caseObj._attachMeta = attachMeta;
  return caseObj;
}

function subBucketToStep(b, buckets, parentStartedAt) {
  if (!b) return null;
  const startedAt = b.startedAt || parentStartedAt || new Date().toISOString();
  const duration = Math.max(0, Math.round((b.elapsed || 0) * 1000));
  const status = mapStatus(b);
  const stepStatus = status === 'broken' ? 'fail' : status; // step enum has no 'broken'
  const step = {
    id: shortId('step'),
    title: lastPart(b.test),
    status: stepStatus,
    startedAt,
    duration,
    phase: 'body',
  };
  // recurse into deeper sub-tests
  const childKeys = Array.from(buckets.keys()).filter(k => {
    const cb = buckets.get(k);
    return cb && cb.parentKey === keyFor(b.pkg, b.test) && cb.parts.length === b.parts.length + 1;
  });
  if (childKeys.length) {
    step.children = [];
    for (const ck of childKeys.sort()) {
      const child = subBucketToStep(buckets.get(ck), buckets, startedAt);
      if (child) step.children.push(child);
    }
  }
  // Capture failure output as an assertion stack so the viewer renders it.
  if (status === 'fail') {
    const stack = b.output.join('\n').trim();
    if (stack) step.assertion = { stack };
  }
  return step;
}

function keyFor(pkg, test) { return `${pkg}::${test}`; }

function lastPart(test) {
  const parts = splitTestPath(test);
  return parts[parts.length - 1];
}

function mapStatus(b) {
  if (b.panic && b.status !== 'pass') return 'fail';
  if (b.status === 'pass') return 'pass';
  if (b.status === 'fail') return 'fail';
  if (b.status === 'skip') return 'skip';
  // No terminal action recorded — likely a build failure or interrupted run.
  return 'broken';
}

function collectErrors(b) {
  if (b.status !== 'fail' && !b.panic) return [];
  const text = b.output.join('\n');
  // First, look for a panic stanza — `panic: <message>` followed by goroutine
  // frames is the canonical Go panic shape.
  const panicMatch = /^\s*panic:\s*(.*)$/m.exec(text);
  if (panicMatch) {
    return [{
      message: panicMatch[1].trim() || 'panic',
      stack: text.trim(),
      type: 'panic',
    }];
  }
  // Otherwise pull the first `--- FAIL: …` block plus the surrounding lines.
  const failRe = /^\s*([\w./_-]+\.go:\d+):\s*(.*)$/m;
  const m = failRe.exec(text);
  if (m) {
    return [{
      message: m[2].trim() || 'test failed',
      stack: text.trim(),
    }];
  }
  // Fallback — first non-empty line.
  const first = text.split(/\n/).map(s => s.trim()).find(Boolean);
  return [{
    message: first || 'test failed',
    stack: text.trim() || undefined,
  }];
}

function collectLogs(b, startedAt) {
  const logs = [];
  const baseMs = Date.parse(startedAt);
  let i = 0;
  for (const line of b.output) {
    const trimmed = line.replace(/\s+$/, '');
    if (!trimmed) continue;
    if (trimmed.startsWith(META_PREFIX)) continue;
    // Skip the structural `=== RUN`, `--- PASS`, `--- FAIL` lines — they're
    // noise for the report viewer (the case status/duration already capture
    // that information).
    if (/^\s*===\s+(RUN|PAUSE|CONT|NAME)/.test(trimmed)) continue;
    if (/^\s*---\s+(PASS|FAIL|SKIP)/.test(trimmed)) continue;
    if (/^\s*PASS\s*$/.test(trimmed)) continue;
    if (/^\s*FAIL\s*$/.test(trimmed)) continue;
    if (/^\s*ok\s+\S+\s+\S+\s*$/.test(trimmed)) continue;
    const level = /panic|error|FAIL/i.test(trimmed) ? 'error'
      : /warn/i.test(trimmed) ? 'warn'
      : 'info';
    logs.push({ t: Math.max(0, i++), level, msg: trimmed });
  }
  return logs;
}

function metaTags(meta) {
  return meta.filter(m => m && m.kind === 'tag' && m.value).map(m => String(m.value));
}

function metaLabels(meta) {
  const out = {};
  for (const m of meta) {
    if (m && m.kind === 'label' && m.key) out[String(m.key)] = String(m.value ?? '');
  }
  return out;
}

function metaLinks(meta) {
  const out = [];
  for (const m of meta) {
    if (m && m.kind === 'link' && m.url) {
      const link = { url: String(m.url) };
      if (m.linkKind) link.kind = String(m.linkKind);
      if (m.label) link.label = String(m.label);
      out.push(link);
    }
  }
  return out;
}

function metaParameters(meta) {
  return meta
    .filter(m => m && m.kind === 'parameter' && m.name)
    .map(m => ({
      name: String(m.name),
      value: String(m.value ?? ''),
    }));
}

// metaScalar returns the last value for a single-valued meta kind (owner,
// description, …) — last-write-wins, mirroring how labels behave.
function metaScalar(meta, kind) {
  let out;
  for (const m of meta) {
    if (m && m.kind === kind && m.value != null && String(m.value) !== '') out = String(m.value);
  }
  return out;
}

// metaStory returns the story value (from a story meta, falling back to a
// scenario meta) so it can be mirrored into labels.story.
function metaStory(meta) {
  let story, scenario;
  for (const m of meta) {
    if (!m || !m.value) continue;
    if (m.kind === 'story') story = String(m.value);
    else if (m.kind === 'scenario') scenario = String(m.value);
  }
  return story || scenario;
}

function metaBehavior(meta) {
  const out = {};
  for (const m of meta) {
    if (!m || !m.value) continue;
    if (m.kind === 'feature') out.feature = String(m.value);
    else if (m.kind === 'epic') out.epic = String(m.value);
    else if (m.kind === 'scenario' || m.kind === 'story') out.scenario = String(m.value);
  }
  return out;
}

function metaSeverity(meta) {
  for (const m of meta) {
    if (m && m.kind === 'severity' && m.value) {
      const v = String(m.value).toLowerCase();
      if (SEVERITY_NAMES.includes(v)) return v;
    }
  }
  return undefined;
}

function metaSteps(meta) {
  // Build the step tree from interleaved step_start / step_end records.
  // `id` strings are user-supplied so we use them as the join key; if a
  // user forgets to call `step_end`, the unmatched step is left as `pass`
  // (no duration available).
  const open = []; // stack of open steps (innermost last)
  const roots = [];
  for (const m of meta) {
    if (!m) continue;
    if (m.kind === 'step_start') {
      const step = {
        id: m.id ? `step_${String(m.id)}` : shortId('step'),
        _userId: m.id,
        title: String(m.title || 'step'),
        status: 'pass',
        startedAt: safeIso(m.t) || new Date().toISOString(),
        duration: 0,
        phase: 'body',
        _startedMs: typeof m.t === 'number' ? m.t : Date.parse(safeIso(m.t) || new Date().toISOString()),
      };
      if (m.action) step.action = String(m.action);
      const parent = open[open.length - 1];
      if (parent) (parent.children ||= []).push(step);
      else roots.push(step);
      open.push(step);
    } else if (m.kind === 'step_end') {
      // close the matching step (by id or topmost)
      let idx = -1;
      if (m.id) {
        for (let i = open.length - 1; i >= 0; i--) {
          if (open[i]._userId === m.id) { idx = i; break; }
        }
      }
      if (idx === -1) idx = open.length - 1;
      if (idx === -1) continue;
      const step = open.splice(idx, 1)[0];
      if (m.status && (m.status === 'pass' || m.status === 'fail' || m.status === 'skip')) {
        step.status = m.status;
      }
      const endMs = typeof m.t === 'number' ? m.t : Date.parse(safeIso(m.t) || new Date().toISOString());
      step.duration = Math.max(0, Math.round(endMs - (step._startedMs || endMs)));
      delete step._startedMs;
      delete step._userId;
    }
  }
  // Force-close any leaks — we never want a partial step to leave dangling
  // _internal fields in the output JSON.
  for (const step of open) {
    delete step._startedMs;
    delete step._userId;
  }
  // Strip helpers from nested children too.
  const strip = (s) => {
    if (!s) return;
    delete s._startedMs;
    delete s._userId;
    (s.children || []).forEach(strip);
  };
  roots.forEach(strip);
  return roots;
}

function materialiseAttachments(caseObj, attachmentsRoot, outDir) {
  // The Go helper uses meta with kind "attach" — we copy the file into the
  // bundle so the report directory is self-contained.
  if (!Array.isArray(caseObj._attachMeta)) return;
  for (const att of caseObj._attachMeta) {
    if (!att.path) continue;
    const src = isAbsolute(att.path) ? att.path : resolve(process.cwd(), att.path);
    if (!existsSync(src)) continue;
    const destDir = resolve(attachmentsRoot, caseObj.id);
    mkdirSync(destDir, { recursive: true });
    const ext = extname(src).toLowerCase();
    const attId = shortId('att');
    const destName = `${attId}_${att.name || basename(src)}`;
    const dest = resolve(destDir, destName);
    try { copyFileSync(src, dest); } catch { continue; }
    const rec = {
      id: attId,
      kind: att.kind || KIND_BY_EXT[ext] || 'text',
      relativePath: dest.slice(outDir.length).replace(/^[\/\\]/, ''),
      mimeType: att.mimeType || MIME_BY_EXT[ext] || 'application/octet-stream',
    };
    const sz = (() => { try { return statSync(dest).size; } catch { return undefined; } })();
    if (sz !== undefined) rec.sizeBytes = sz;
    const sha = fileHash(dest);
    if (sha) rec.sha256 = sha;
    (caseObj.attachments ||= []).push(rec);
  }
  delete caseObj._attachMeta;
}
