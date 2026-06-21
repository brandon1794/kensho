// kensho summary — a Markdown digest of a run, for PR comments and CI summaries.
//
//   kensho summary <results-or-report-dir> [--format md|gh] [--out <file>]
//
// Accepts either a kensho-results/ dir (run.json + cases/) or a generated
// kensho-report/ dir (data/index.json + data/cases/). Emits a totals table
// plus the top-10 failures (with category + a one-line error preview).
//
//   --format md   plain Markdown to stdout (default), or to --out.
//   --format gh   GitHub-flavored; when --out is omitted it appends to the
//                 file named by $GITHUB_STEP_SUMMARY (the CI job summary).

import { readFileSync, writeFileSync, readdirSync, existsSync, appendFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

// Load a run from either layout. Returns { run, cases } where cases are the
// fullest available per-case objects.
function loadAny(dir) {
  // 1. results layout: run.json (+ cases/)
  const runPath = join(dir, 'run.json');
  if (existsSync(runPath)) {
    const run = JSON.parse(readFileSync(runPath, 'utf8'));
    const byId = new Map((run.testCases || []).map(c => [c.id, c]));
    const casesDir = join(dir, 'cases');
    if (existsSync(casesDir)) {
      for (const f of readdirSync(casesDir).filter(n => n.endsWith('.json'))) {
        try { const c = JSON.parse(readFileSync(join(casesDir, f), 'utf8')); byId.set(c.id, c); }
        catch { /* skip */ }
      }
    }
    return { run, cases: [...byId.values()] };
  }
  // 2. report layout: data/index.json (+ data/cases/)
  const idxPath = join(dir, 'data', 'index.json');
  if (existsSync(idxPath)) {
    const idx = JSON.parse(readFileSync(idxPath, 'utf8'));
    const run = {
      project: idx.project, framework: idx.framework, env: idx.env,
      startedAt: idx.startedAt, finishedAt: idx.finishedAt,
      durationMs: idx.durationMs, totals: idx.totals,
    };
    return { run, cases: idx.cases || [] };
  }
  throw new Error(`no run.json or data/index.json found in ${dir}`);
}

function totalsTable(t) {
  const sum = (t.pass || 0) + (t.fail || 0) + (t.broken || 0) + (t.skip || 0);
  const rate = sum ? (((t.pass || 0) / sum) * 100).toFixed(1) : '0.0';
  return [
    '| Result | Count |',
    '|---|---|',
    `| ✅ Pass | ${t.pass || 0} |`,
    `| ❌ Fail | ${t.fail || 0} |`,
    `| 💥 Broken | ${t.broken || 0} |`,
    `| ⏭️ Skip | ${t.skip || 0} |`,
    `| **Total** | **${sum}** |`,
    `| **Pass rate** | **${rate}%** |`,
  ].join('\n');
}

// Escape pipe/newlines so a message can't break the Markdown table.
function cell(s) {
  return String(s || '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

function previewOf(c) {
  if (c.errorPreview) return c.errorPreview;
  const msg = c.errors?.[0]?.message || '';
  return msg.slice(0, 160);
}

export function buildSummary({ run, cases }) {
  const t = run.totals || { pass: 0, fail: 0, broken: 0, skip: 0 };
  const proj = run.project?.name || 'Kensho run';
  const lines = [];
  lines.push(`## ${proj} — test summary`);
  lines.push('');
  const meta = [];
  if (run.framework?.name) meta.push(run.framework.name);
  if (run.env?.branch) meta.push(`branch \`${run.env.branch}\``);
  if (run.env?.commit) meta.push(`commit \`${String(run.env.commit).slice(0, 8)}\``);
  if (meta.length) { lines.push(meta.join(' · ')); lines.push(''); }
  lines.push(totalsTable(t));
  lines.push('');

  const failures = cases
    .filter(c => c.status === 'fail' || c.status === 'broken')
    .slice(0, 10);
  if (failures.length) {
    lines.push(`### Top ${failures.length} failure${failures.length === 1 ? '' : 's'}`);
    lines.push('');
    lines.push('| Test | Category | Error |');
    lines.push('|---|---|---|');
    for (const c of failures) {
      lines.push(`| ${cell(c.fullName || c.name)} | ${cell(c.category || '—')} | ${cell(previewOf(c))} |`);
    }
    lines.push('');
  } else {
    lines.push('All tests passed. ✅');
    lines.push('');
  }
  return lines.join('\n');
}

export async function summaryCli({ input, format = 'md', out }) {
  const dir = resolve(input);
  if (!existsSync(dir)) throw new Error(`directory not found: ${dir}`);
  const loaded = loadAny(dir);
  const md = buildSummary(loaded);

  if (out) {
    writeFileSync(resolve(out), md + '\n');
    console.log(`[kensho] summary written to ${relative(process.cwd(), resolve(out))}`);
    return 0;
  }
  if (format === 'gh') {
    const stepSummary = process.env.GITHUB_STEP_SUMMARY;
    if (stepSummary) {
      appendFileSync(stepSummary, md + '\n');
      console.log('[kensho] summary appended to $GITHUB_STEP_SUMMARY');
      return 0;
    }
    // No GITHUB_STEP_SUMMARY available — fall back to stdout so the command
    // still does something useful locally.
    process.stdout.write(md + '\n');
    return 0;
  }
  process.stdout.write(md + '\n');
  return 0;
}
