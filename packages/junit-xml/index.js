// @kaizenreport/kensho-junit-xml — Convert JUnit XML files (pytest, gradle,
// jest-junit, mocha-junit-reporter, …) into kensho-results/.
// Zero-dep XML parser: tolerates most JUnit dialects, ignores the rest.

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { resolve, relative, dirname, basename } from 'node:path';
import { emptyRun, computeTotals, stableCaseId, validateRun, envInfo } from '@kaizenreport/kensho-schema';

// envInfo() is imported from @kaizenreport/kensho-schema below.

// --- tiny XML → tree parser (no deps) -----------------------------------

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

function parseAttrs(str) {
  const out = {};
  const re = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(str))) out[m[1]] = decodeEntities(m[3] ?? m[4] ?? '');
  return out;
}

/**
 * Parse an XML string into a simple node tree: { name, attrs, children, text }.
 * Skips CDATA-wrapping; preserves text between children.
 */
export function parseXml(xml) {
  const root = { name: '__root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const src = xml.replace(/<\?xml[^?]*\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const tokenRe = /<!\[CDATA\[([\s\S]*?)\]\]>|<\/([\w:-]+)\s*>|<([\w:-]+)((?:\s+[^/>]+)?)\s*(\/)?\s*>|([^<]+)/g;
  let m;
  while ((m = tokenRe.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) {
      top.text += m[1];
    } else if (m[2]) {
      // close tag
      if (top.name === m[2]) stack.pop();
    } else if (m[3]) {
      const node = { name: m[3], attrs: parseAttrs(m[4] || ''), children: [], text: '' };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6]) {
      const t = decodeEntities(m[6]);
      if (t.trim()) top.text += t;
    }
  }
  return root;
}

function findAll(node, name, out = []) {
  for (const c of node.children || []) {
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}

function firstChild(node, name) {
  return (node.children || []).find(c => c.name === name);
}

// --- JUnit → Kensho ------------------------------------------------------

function mapStatus(tc) {
  if (firstChild(tc, 'failure') || firstChild(tc, 'error')) {
    return firstChild(tc, 'error') && !firstChild(tc, 'failure') ? 'broken' : 'fail';
  }
  if (firstChild(tc, 'skipped')) return 'skip';
  return 'pass';
}

function secondsToMs(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 1000)) : 0;
}

function tcToKenshoCase(tc, suiteName, suiteFile, usedIds) {
  const name = tc.attrs.name || 'unnamed';
  const classname = tc.attrs.classname || suiteName || '';
  const suite = classname ? classname.split(/[.>]/).map(s => s.trim()).filter(Boolean) : [];
  const fullName = (classname ? classname + ' › ' : '') + name;
  const filePath = tc.attrs.file || suiteFile || undefined;
  const fp = filePath ? (filePath.startsWith('/') ? relative(process.cwd(), filePath) : filePath) : undefined;

  let id = stableCaseId(fullName, fp);
  if (usedIds.has(id)) {
    let i = 2;
    while (usedIds.has(id + '_' + i)) i++;
    id = id + '_' + i;
  }
  usedIds.add(id);

  const status = mapStatus(tc);
  const duration = secondsToMs(tc.attrs.time);
  const startedAt = new Date().toISOString();
  const finishedAt = new Date(Date.parse(startedAt) + duration).toISOString();

  const errNode = firstChild(tc, 'failure') || firstChild(tc, 'error');
  const skipNode = firstChild(tc, 'skipped');
  const errors = errNode ? [{
    message: errNode.attrs.message || (errNode.text || '').split('\n')[0] || 'error',
    type: errNode.attrs.type,
    stack: errNode.text || errNode.attrs.message,
  }] : undefined;

  const logs = [];
  const sysout = firstChild(tc, 'system-out');
  const syserr = firstChild(tc, 'system-err');
  if (sysout && sysout.text) logs.push({ stream: 'stdout', text: sysout.text });
  if (syserr && syserr.text) logs.push({ stream: 'stderr', text: syserr.text });

  return {
    id,
    name,
    fullName,
    filePath: fp,
    line: tc.attrs.line ? parseInt(tc.attrs.line, 10) : undefined,
    suite,
    tags: [],
    status,
    startedAt,
    finishedAt,
    duration,
    retries: 0,
    platform: process.platform,
    steps: [],
    errors,
    attachments: [],
    logs,
    ...(skipNode && skipNode.attrs.message ? { skipReason: skipNode.attrs.message } : {}),
  };
}

/**
 * Convert one or more JUnit XML files into a kensho-results/ bundle.
 *
 * @param {string | string[]} xmlPaths
 * @param {string} [outputDir]
 * @param {{ project?: {name?:string,slug?:string,url?:string}, runId?: string }} [opts]
 */
export function convertJUnit(xmlPaths, outputDir = 'kensho-results', opts = {}) {
  const inputs = Array.isArray(xmlPaths) ? xmlPaths : [xmlPaths];
  const outDir = resolve(process.cwd(), outputDir);
  const casesDir = resolve(outDir, 'cases');
  const attachmentsDir = resolve(outDir, 'attachments');
  mkdirSync(outDir, { recursive: true });
  mkdirSync(casesDir, { recursive: true });
  mkdirSync(attachmentsDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const usedIds = new Set();
  const cases = [];

  for (const p of inputs) {
    if (!existsSync(p)) {
      console.warn('[kensho] input not found:', p);
      continue;
    }
    const xml = readFileSync(p, 'utf8');
    const tree = parseXml(xml);
    const suites = findAll(tree, 'testsuite');
    // If the file root is <testsuites> or bare <testsuite>, both work.
    const suiteNodes = suites.length ? suites : findAll(tree, 'testsuites');
    for (const ts of suiteNodes) {
      const suiteName = ts.attrs.name;
      const suiteFile = ts.attrs.file;
      for (const tc of findAll(ts, 'testcase')) {
        const c = tcToKenshoCase(tc, suiteName, suiteFile, usedIds);
        writeFileSync(resolve(casesDir, c.id + '.json'), JSON.stringify(c, null, 2));
        cases.push(c);
      }
    }
  }

  const finishedAt = new Date().toISOString();
  const run = emptyRun({
    id: opts.runId || ('run_' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)),
    project: {
      name: opts.project?.name || 'Unknown project',
      slug: opts.project?.slug || 'unknown',
      url: opts.project?.url,
    },
    framework: { name: 'junit-xml', version: '0.1.0' },
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
    console.warn('[kensho] run.json failed validation:');
    for (const e of errors.slice(0, 8)) console.warn('  -', e);
  }
  console.log(`[kensho] wrote ${cases.length} cases + run.json to ${outDir}`);
  return { outputDir: outDir, cases: cases.length };
}

export default convertJUnit;
