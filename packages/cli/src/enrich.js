// kensho enrich — generate-time enrichment for FAILED cases.
//
// Two best-effort passes run inside `generate` after cases load, before
// serialization. Both are defensive: they NEVER throw and NEVER fail the
// generate. The worst case is a case that simply isn't enriched.
//
//   addSourceSnippet(case, root)  — read ±6 source lines around the failure
//                                   site (filePath:line, else first in-repo
//                                   stack frame) into case.sourceSnippet.
//   assignCategory(case, rules)   — bucket the failure into case.category,
//                                   from config rules first, else an
//                                   auto-clustered signature of the message.
//
// Public API:
//   enrichRun(run, { root, snippets, config }) — mutates run.testCases in place
//   loadCategoryRules(input)                   — read kensho.config.json rules
//   addSourceSnippet / assignCategory          — exported for tests

import { readFileSync, realpathSync, statSync, existsSync } from 'node:fs';
import { resolve, relative, join, sep, extname, isAbsolute } from 'node:path';

const SNIPPET_CONTEXT = 6;          // lines above/below the failure line
const MAX_SNIPPET_BYTES = 2 * 1024 * 1024;
const SIG_MAX_LEN = 80;

// ---------------------------------------------------------------------------
// Source snippet
// ---------------------------------------------------------------------------

// Map a file extension to a coarse language hint the viewer can use for
// syntax styling. Best-effort — unknown extensions get no lang.
const LANG_BY_EXT = {
  '.ts': 'typescript', '.tsx': 'tsx', '.mts': 'typescript', '.cts': 'typescript',
  '.js': 'javascript', '.jsx': 'jsx', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python', '.rb': 'ruby', '.go': 'go', '.rs': 'rust',
  '.java': 'java', '.kt': 'kotlin', '.scala': 'scala', '.groovy': 'groovy',
  '.cs': 'csharp', '.fs': 'fsharp', '.vb': 'vbnet',
  '.php': 'php', '.swift': 'swift', '.m': 'objectivec', '.mm': 'objectivec',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp',
  '.sh': 'bash', '.bash': 'bash', '.ps1': 'powershell',
  '.sql': 'sql', '.html': 'html', '.css': 'css', '.scss': 'scss',
  '.json': 'json', '.yml': 'yaml', '.yaml': 'yaml', '.feature': 'gherkin',
};

function langForFile(file) {
  return LANG_BY_EXT[extname(file).toLowerCase()] || undefined;
}

// Pull the first in-repo "<file>:<line>" frame out of a stack string. We
// prefer relative paths (most adapters write repo-relative frames) but also
// match absolute paths. Returns { file, line } or null.
function frameFromStack(stack) {
  if (!stack || typeof stack !== 'string') return null;
  // Matches "foo/bar.spec.ts:25" and "foo/bar.spec.ts:25:9" (col stripped).
  const re = /([A-Za-z0-9_./\\:-]+\.[A-Za-z0-9]+):(\d+)(?::\d+)?/g;
  let m;
  while ((m = re.exec(stack))) {
    const file = m[1];
    // Skip obvious dependency/internal frames — we want the user's code.
    if (/node_modules|[\\/]dist[\\/]|[\\/]\.pnpm[\\/]|internal[\\/]/.test(file)) continue;
    const line = parseInt(m[2], 10);
    if (Number.isInteger(line) && line > 0) return { file, line };
  }
  return null;
}

// Resolve `candidate` (repo-relative or absolute) inside `root`, defending
// against `..`/symlink escapes. Returns { real, realRoot } where both paths
// are symlink-resolved (so repo-relative paths stay clean), or null if the
// file escapes the root or doesn't exist.
function resolveInRoot(root, candidate) {
  if (!root || !candidate) return null;
  let realRoot;
  try {
    realRoot = realpathSync(root);
  } catch {
    realRoot = resolve(root);
  }
  const abs = isAbsolute(candidate) ? candidate : join(realRoot, candidate);
  let real;
  try {
    real = realpathSync(abs);          // resolves symlinks too
  } catch {
    return null;                       // missing file
  }
  // Containment check: must live under realRoot (or be realRoot itself).
  if (real !== realRoot && !real.startsWith(realRoot + sep)) return null;
  return { real, realRoot };
}

// Sniff for a binary file: a NUL byte in the first chunk means "don't read".
function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/**
 * Best-effort source snippet for a failing case. Never throws.
 * Sets case.sourceSnippet = { file (repo-relative), line, lang, lines:[...] }.
 */
export function addSourceSnippet(c, root) {
  try {
    if (!c || !root) return;
    // 1. Locate the failure site.
    let target = null;
    if (c.filePath && Number.isInteger(c.line) && c.line > 0) {
      target = { file: c.filePath, line: c.line };
    } else {
      target = frameFromStack(c.errors?.[0]?.stack);
    }
    if (!target) return;

    // 2. Resolve safely inside the root.
    const resolved = resolveInRoot(root, target.file);
    if (!resolved) return;
    const { real, realRoot } = resolved;

    // 3. Size + binary guards.
    let st;
    try { st = statSync(real); } catch { return; }
    if (!st.isFile() || st.size > MAX_SNIPPET_BYTES) return;

    const buf = readFileSync(real);
    if (looksBinary(buf)) return;

    const all = buf.toString('utf8').split(/\r\n|\r|\n/);
    const errLine = target.line;
    const start = Math.max(1, errLine - SNIPPET_CONTEXT);
    const end = Math.min(all.length, errLine + SNIPPET_CONTEXT);
    const lines = [];
    for (let n = start; n <= end; n++) {
      lines.push({ n, text: all[n - 1] ?? '', isError: n === errLine });
    }
    if (!lines.length) return;

    // Report the path repo-relative, with forward slashes for portability.
    let rel = relative(realRoot, real) || target.file;
    rel = rel.split(sep).join('/');

    c.sourceSnippet = {
      file: rel,
      line: errLine,
      lang: langForFile(real),
      lines,
    };
  } catch {
    // Best-effort: swallow everything.
  }
}

// ---------------------------------------------------------------------------
// Category assignment
// ---------------------------------------------------------------------------

/**
 * Load category rules from kensho.config.json. Looks at the root of the
 * results input first, then the cwd. Returns [] on any problem.
 *
 * Rule shape: { name, matchedStatuses?, messageRegex?, traceRegex? }
 */
export function loadCategoryRules(input) {
  const candidates = [];
  if (input) candidates.push(join(input, 'kensho.config.json'));
  candidates.push(join(process.cwd(), 'kensho.config.json'));
  for (const p of candidates) {
    try {
      if (!existsSync(p)) continue;
      const cfg = JSON.parse(readFileSync(p, 'utf8'));
      const rules = cfg?.categories;
      if (Array.isArray(rules)) return rules.filter(r => r && r.name);
    } catch {
      // ignore malformed config — fall through to auto-clustering
    }
  }
  return [];
}

// Compile a rule's regex strings once. Invalid regex → undefined (skipped).
function compileRule(rule) {
  const re = (s) => {
    if (!s || typeof s !== 'string') return undefined;
    try { return new RegExp(s, 'i'); } catch { return undefined; }
  };
  return {
    name: rule.name,
    statuses: Array.isArray(rule.matchedStatuses) ? rule.matchedStatuses : null,
    message: re(rule.messageRegex),
    trace: re(rule.traceRegex),
  };
}

// Normalize an error message into a stable signature: lowercase, strip
// volatile bits (digits, hex, quotes, paths, UUIDs), collapse whitespace,
// then cap the length. Two errors that differ only by an id/number/path
// collapse to the same bucket.
function signature(msg) {
  let s = String(msg || '').toLowerCase();
  s = s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ''); // UUID
  s = s.replace(/0x[0-9a-f]+/g, '');                  // hex literals
  s = s.replace(/['"`].*?['"`]/g, '');                // quoted strings
  s = s.replace(/[a-z0-9_.-]+\/[a-z0-9_./-]+/g, '');  // paths
  s = s.replace(/\b[0-9a-f]{6,}\b/g, '');             // long hex blobs
  s = s.replace(/\d+/g, '');                          // remaining digits
  s = s.replace(/[^a-z ]+/g, ' ');                    // punctuation → space
  s = s.replace(/\s+/g, ' ').trim();                  // collapse whitespace
  return s.slice(0, SIG_MAX_LEN).trim();
}

// Well-known buckets keyed by a substring of the normalized signature. First
// match wins, in order. Falls back to a Title-Cased version of the signature.
// Matched against the lowercased *raw* message (so HTTP codes, paths, and
// punctuation survive) — first match wins.
const AUTO_BUCKETS = [
  [/timeout|timed out|exceeded \d+\s*ms|waitfor/, 'Timeout'],
  [/network|econnrefused|econnreset|fetch failed|socket|\bhttp\b|\b50[234]\b|\bdns\b/, 'Network'],
  [/stale element|element .*(?:not|isn't|is not) (?:found|present|visible|attached)|element reference is stale|no such element|unable to (?:locate|find) element|selector/, 'Element not found'],
  [/forbidden|unauthorized|permission denied|access denied|\b40[13]\b/, 'Permissions'],
  [/assert|expect(?:ed)?|to be |to equal|to contain|to have |tobe|toequal/, 'Assertion'],
  [/null|undefined|cannot read|is not defined|nonetype|nullpointer|referenceerror/, 'Null/undefined reference'],
  [/type ?error|not a function|is not iterable/, 'Type error'],
  [/database|\bsql\b|deadlock|constraint|connection pool/, 'Database'],
  [/snapshot|screenshot .*diff|visual/, 'Visual diff'],
];

function autoCategory(c) {
  const raw = String(c.errors?.[0]?.message || '').toLowerCase();
  const sig = signature(c.errors?.[0]?.message);
  if (!raw && !sig) return undefined;
  for (const [re, name] of AUTO_BUCKETS) {
    if (re.test(raw)) return name;
  }
  if (!sig) return undefined;
  // Fall back to a shared bucket from the signature itself so similar errors
  // still cluster together.
  const words = sig.split(' ').filter(Boolean).slice(0, 4);
  if (!words.length) return undefined;
  return words.map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Assign case.category for a failing case. Config rules win (first match);
 * otherwise auto-cluster by normalized message signature. Never throws.
 *
 * @param {object} c            the case (mutated)
 * @param {object[]} compiled   pre-compiled rules from compileRules()
 */
export function assignCategory(c, compiled) {
  try {
    if (!c) return;
    const status = c.status;
    const msg = c.errors?.[0]?.message || '';
    const trace = c.errors?.[0]?.stack || '';
    for (const r of compiled) {
      if (r.statuses && !r.statuses.includes(status)) continue;
      if (r.message && !r.message.test(msg)) continue;
      if (r.trace && !r.trace.test(trace)) continue;
      // A rule with no message/trace/status predicate is a catch-all.
      c.category = r.name;
      return;
    }
    const auto = autoCategory(c);
    if (auto) c.category = auto;
  } catch {
    // best-effort
  }
}

function compileRules(rules) {
  const out = [];
  for (const r of rules || []) {
    try { out.push(compileRule(r)); } catch { /* skip bad rule */ }
  }
  return out;
}

/**
 * Enrich a loaded run in place. Only failing cases (fail/broken) are touched.
 *
 * @param {object} run
 * @param {object} opts
 * @param {string} opts.root        project/repo root for snippet resolution
 * @param {boolean} opts.snippets   set false to skip source snippets
 * @param {object[]} opts.rules     category rules (from loadCategoryRules)
 */
export function enrichRun(run, { root, snippets = true, rules = [] } = {}) {
  if (!run || !Array.isArray(run.testCases)) return run;
  const compiled = compileRules(rules);
  for (const c of run.testCases) {
    if (c.status !== 'fail' && c.status !== 'broken') continue;
    assignCategory(c, compiled);
    if (snippets && root) addSourceSnippet(c, root);
  }
  return run;
}
