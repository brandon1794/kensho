// kensho export-junit — emit a JUnit XML report from a kensho-results/ dir.
//
//   kensho export-junit <results-dir> --out <file.xml>
//
// Produces a standard <testsuites>/<testsuite>/<testcase> document that any
// JUnit consumer (GitLab, Jenkins, Bitbucket, GitHub test reporters) accepts.
// Mapping:
//   fail   → <failure>
//   broken → <error>
//   skip   → <skipped>
//   pass   → bare <testcase>
// Test cases are grouped into a <testsuite> per top-level suite (or filePath).
// All attribute/text content is XML-escaped; stacks go in CDATA (with ]]>
// split so they can't terminate the section early); control chars are stripped.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

function loadResults(dir) {
  const runPath = join(dir, 'run.json');
  if (!existsSync(runPath)) throw new Error(`missing run.json in ${dir}`);
  const run = JSON.parse(readFileSync(runPath, 'utf8'));
  const byId = new Map((run.testCases || []).map(c => [c.id, c]));
  const casesDir = join(dir, 'cases');
  if (existsSync(casesDir)) {
    for (const f of readdirSync(casesDir).filter(n => n.endsWith('.json'))) {
      try { const c = JSON.parse(readFileSync(join(casesDir, f), 'utf8')); byId.set(c.id, c); }
      catch { /* skip */ }
    }
  }
  run.testCases = [...byId.values()];
  return run;
}

// XML 1.0 disallows most control chars (except tab/newline/CR). Strip them so
// the document stays well-formed regardless of what an adapter captured.
function stripControl(s) {
  // eslint-disable-next-line no-control-regex
  return String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function esc(s) {
  return stripControl(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// CDATA can't contain the literal `]]>`; split it across two sections.
function cdata(s) {
  const safe = stripControl(s).replace(/]]>/g, ']]]]><![CDATA[>');
  return `<![CDATA[${safe}]]>`;
}

function suiteKeyOf(c) {
  if (Array.isArray(c.suite) && c.suite.length) return c.suite[0];
  if (c.filePath) return c.filePath;
  return 'kensho';
}

export async function exportJunit({ input, out }) {
  const dir = resolve(input);
  if (!existsSync(dir)) throw new Error(`results dir not found: ${dir}`);
  if (!out) throw new Error('export-junit requires --out <file.xml>');
  const run = loadResults(dir);

  // Group cases into suites.
  const suites = new Map();
  for (const c of run.testCases) {
    const k = suiteKeyOf(c);
    if (!suites.has(k)) suites.set(k, []);
    suites.get(k).push(c);
  }

  const t = run.totals || {};
  const grandTotal = run.testCases.length;
  const grandFail = (t.fail || 0);
  const grandErr = (t.broken || 0);
  const grandSkip = (t.skip || 0);
  const grandTime = ((run.durationMs || run.testCases.reduce((s, c) => s + (c.duration || 0), 0)) / 1000).toFixed(3);

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<testsuites name="${esc(run.project?.name || 'kensho')}" tests="${grandTotal}" ` +
    `failures="${grandFail}" errors="${grandErr}" skipped="${grandSkip}" time="${grandTime}">`
  );

  for (const [suiteName, cases] of suites) {
    const sFail = cases.filter(c => c.status === 'fail').length;
    const sErr = cases.filter(c => c.status === 'broken').length;
    const sSkip = cases.filter(c => c.status === 'skip').length;
    const sTime = (cases.reduce((s, c) => s + (c.duration || 0), 0) / 1000).toFixed(3);
    const ts = cases[0]?.startedAt ? ` timestamp="${esc(cases[0].startedAt)}"` : '';
    lines.push(
      `  <testsuite name="${esc(suiteName)}" tests="${cases.length}" ` +
      `failures="${sFail}" errors="${sErr}" skipped="${sSkip}" time="${sTime}"${ts}>`
    );
    for (const c of cases) {
      const cls = Array.isArray(c.suite) ? c.suite.join('.') : (c.filePath || suiteName);
      const time = ((c.duration || 0) / 1000).toFixed(3);
      const open =
        `    <testcase name="${esc(c.name || c.fullName || c.id)}" ` +
        `classname="${esc(cls)}" time="${time}"${c.filePath ? ` file="${esc(c.filePath)}"` : ''}` +
        `${Number.isInteger(c.line) ? ` line="${c.line}"` : ''}>`;
      const err = c.errors?.[0];
      const message = esc(err?.message || (c.status === 'broken' ? 'broken' : c.status === 'fail' ? 'failed' : ''));
      const type = err?.type ? ` type="${esc(err.type)}"` : '';
      if (c.status === 'fail') {
        lines.push(open);
        lines.push(`      <failure message="${message}"${type}>${cdata(err?.stack || err?.message || '')}</failure>`);
        lines.push('    </testcase>');
      } else if (c.status === 'broken') {
        lines.push(open);
        lines.push(`      <error message="${message}"${type}>${cdata(err?.stack || err?.message || '')}</error>`);
        lines.push('    </testcase>');
      } else if (c.status === 'skip') {
        lines.push(open);
        lines.push('      <skipped/>');
        lines.push('    </testcase>');
      } else {
        // pass — self-closing
        lines.push(open.replace(/>$/, '/>'));
      }
    }
    lines.push('  </testsuite>');
  }
  lines.push('</testsuites>');

  const xml = lines.join('\n') + '\n';
  const outPath = resolve(out);
  writeFileSync(outPath, xml);
  console.log(`[kensho] ✓ ${grandTotal} cases → ${relative(process.cwd(), outPath)}`);
  return 0;
}
