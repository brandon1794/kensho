// kensho diff — compare two kensho-results/ directories.
//
// Two consumers share one analysis:
//   · printDiff(diff, { prev, cur }) — colorized terminal punch list
//   · writeDiffSite(diff, { out })   — static HTML report (./diff-html.js)
//
// Public API:
//   computeDiff(prevRun, curRun) → DiffResult
//   loadRun(dir)                 → run.json + per-case enrichment
//   diffRuns({ prev, cur, out, terminal }) — CLI entry; preserves legacy flow
//   The legacy default behaviour (no flags) prints the terminal diff and exits
//   with the regression count — same as before.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ERROR_PREVIEW_LEN = 280;

export function loadRun(dir) {
  const runJson = join(dir, 'run.json');
  if (!existsSync(runJson)) throw new Error('run.json not found in ' + dir);
  const run = JSON.parse(readFileSync(runJson, 'utf8'));
  const casesDir = join(dir, 'cases');
  if (existsSync(casesDir)) {
    const byId = new Map(run.testCases.map(c => [c.id, c]));
    for (const f of readdirSync(casesDir).filter(x => x.endsWith('.json'))) {
      try {
        const full = JSON.parse(readFileSync(join(casesDir, f), 'utf8'));
        byId.set(full.id, full);
      } catch { /* skip */ }
    }
    run.testCases = [...byId.values()];
  }
  return run;
}

function caseSummary(c) {
  return {
    id: c.id,
    name: c.name,
    fullName: c.fullName,
    filePath: c.filePath,
    suite: c.suite,
    tags: c.tags,
    severity: c.severity,
    owner: c.owner,
    duration: c.duration,
    status: c.status,
  };
}

function errorPreview(c) {
  const msg = c?.errors?.[0]?.message || '';
  return msg.slice(0, ERROR_PREVIEW_LEN);
}

function fullError(c) {
  const e = c?.errors?.[0];
  if (!e) return null;
  return {
    type: e.type || null,
    message: e.message || '',
    stack: e.stack || '',
  };
}

function passRateOf(totals) {
  if (!totals) return 0;
  const t = (totals.pass || 0) + (totals.fail || 0) + (totals.broken || 0) + (totals.skip || 0);
  if (!t) return 0;
  return Math.round(((totals.pass || 0) / t) * 100);
}

function runMeta(run) {
  return {
    id: run.id,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    totals: run.totals || {},
    passRate: passRateOf(run.totals),
    project: run.project || null,
    env: run.env ? { branch: run.env.branch, commit: run.env.commit, ci: run.env.ci } : null,
  };
}

// Pure analysis. Takes two run.json-shaped objects, returns the DiffResult that
// drives the terminal printer and the static HTML report.
export function computeDiff(prevRun, curRun) {
  const aById = new Map(prevRun.testCases.map(c => [c.id, c]));
  const bById = new Map(curRun.testCases.map(c => [c.id, c]));

  const newlyFailing = [];
  const newlyPassing = [];
  const statusFlipped = [];
  const stillFailing = [];
  const added = [];
  const removed = [];

  for (const c of curRun.testCases) {
    const prev = aById.get(c.id);
    if (!prev) {
      added.push({
        ...caseSummary(c),
        curError: fullError(c),
        errorPreview: errorPreview(c),
      });
      continue;
    }
    const wasOk = prev.status === 'pass';
    const isOk = c.status === 'pass';
    if (wasOk && !isOk) {
      newlyFailing.push({
        ...caseSummary(c),
        prevStatus: prev.status,
        curStatus: c.status,
        prevDuration: prev.duration,
        curDuration: c.duration,
        errorPreview: errorPreview(c),
        curError: fullError(c),
        prevError: fullError(prev),
      });
    } else if (!wasOk && isOk) {
      newlyPassing.push({
        ...caseSummary(c),
        prevStatus: prev.status,
        curStatus: c.status,
        prevDuration: prev.duration,
        curDuration: c.duration,
        prevErrorPreview: errorPreview(prev),
        prevError: fullError(prev),
        curError: fullError(c),
      });
    } else if (prev.status !== c.status) {
      statusFlipped.push({
        ...caseSummary(c),
        prevStatus: prev.status,
        curStatus: c.status,
        prevDuration: prev.duration,
        curDuration: c.duration,
        prevError: fullError(prev),
        curError: fullError(c),
      });
    } else if (!isOk) {
      stillFailing.push({
        ...caseSummary(c),
        prevStatus: prev.status,
        curStatus: c.status,
        prevDuration: prev.duration,
        curDuration: c.duration,
        errorPreview: errorPreview(c),
        curError: fullError(c),
        prevError: fullError(prev),
      });
    }
  }
  for (const c of prevRun.testCases) {
    if (!bById.has(c.id)) {
      removed.push({
        ...caseSummary(c),
        prevError: fullError(c),
      });
    }
  }

  const durationDeltas = [];
  for (const c of curRun.testCases) {
    const prev = aById.get(c.id);
    if (!prev) continue;
    const a = prev.duration || 0;
    const b = c.duration || 0;
    if (a < 50 || b < 50) continue;
    const deltaPct = ((b - a) / a) * 100;
    if (Math.abs(deltaPct) < 25) continue;
    durationDeltas.push({
      id: c.id,
      name: c.fullName || c.name,
      filePath: c.filePath,
      prevDur: a,
      curDur: b,
      deltaPct: Math.round(deltaPct),
    });
  }
  durationDeltas.sort((x, y) => Math.abs(y.deltaPct) - Math.abs(x.deltaPct));

  const prevMeta = runMeta(prevRun);
  const curMeta = runMeta(curRun);
  const passRateDelta = curMeta.passRate - prevMeta.passRate;

  return {
    schemaVersion: 'kensho-diff/v1',
    generatedAt: new Date().toISOString(),
    prev: prevMeta,
    cur: curMeta,
    changes: {
      newlyFailing,
      newlyPassing,
      statusFlipped,
      added,
      removed,
      stillFailing,
      durationDeltas: durationDeltas.slice(0, 25),
    },
    summary: {
      regressions: newlyFailing.length,
      recoveries: newlyPassing.length,
      flipped: statusFlipped.length,
      added: added.length,
      removed: removed.length,
      stillFailing: stillFailing.length,
      passRateDelta,
    },
  };
}

function fmt(n, color) {
  const codes = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m', reset: '\x1b[0m' };
  if (!process.stdout.isTTY) return String(n);
  return (codes[color] || '') + n + codes.reset;
}

export function printDiff(diff, { prev, cur }) {
  const a = diff.prev;
  const b = diff.cur;
  console.log('\n' + fmt('━━━ Kensho diff ━━━', 'cyan'));
  console.log(`  prev: ${prev}  ·  ${a.totals?.pass || 0}p ${a.totals?.fail || 0}f ${a.totals?.broken || 0}b ${a.totals?.skip || 0}s  ·  pass ${a.passRate}%`);
  console.log(`   cur: ${cur}   ·  ${b.totals?.pass || 0}p ${b.totals?.fail || 0}f ${b.totals?.broken || 0}b ${b.totals?.skip || 0}s  ·  pass ${b.passRate}%`);
  console.log();

  const section = (title, list, color) => {
    if (!list.length) return;
    console.log(fmt(title + ' (' + list.length + ')', color));
    for (const x of list.slice(0, 30)) {
      const flip = x.prevStatus && x.curStatus && x.prevStatus !== x.curStatus
        ? fmt(`  ${x.prevStatus} → ${x.curStatus}`, 'dim')
        : '';
      console.log('  ' + (x.fullName || x.name) + flip);
    }
    if (list.length > 30) console.log(fmt('  …and ' + (list.length - 30) + ' more', 'dim'));
    console.log();
  };

  section('🔴 Newly failing', diff.changes.newlyFailing, 'red');
  section('🟢 Newly passing', diff.changes.newlyPassing, 'green');
  section('🟡 Status flipped (other)', diff.changes.statusFlipped, 'yellow');
  section('➕ Added tests', diff.changes.added, 'cyan');
  section('➖ Removed tests', diff.changes.removed, 'dim');
  if (diff.changes.stillFailing.length) {
    console.log(fmt(`⚠️  Still failing (${diff.changes.stillFailing.length})`, 'red'));
  }
  console.log();
  const breaking = diff.changes.newlyFailing.length;
  if (breaking) {
    console.log(fmt(`✖ ${breaking} regression${breaking === 1 ? '' : 's'} introduced.`, 'red'));
  } else {
    console.log(fmt('✓ No regressions.', 'green'));
  }
}

// CLI entry. Backwards-compatible: with no flags, prints terminal output and
// exits with the regression count (1 if any newly-failing).
//   --out <dir>        also write static HTML report
//   --no-terminal      skip terminal output (useful when piping HTML)
export async function diffRuns({ prev, cur, out, terminal = true }) {
  const a = loadRun(prev);
  const b = loadRun(cur);
  const diff = computeDiff(a, b);

  if (terminal) printDiff(diff, { prev, cur });

  if (out) {
    const { writeDiffSite } = await import('./diff-html.js');
    await writeDiffSite(diff, { out });
    if (terminal) {
      const rel = out;
      console.log(fmt(`✓ static diff report written to ${rel}/`, 'cyan'));
      console.log(fmt(`  open with: npx kensho open --report ${rel}`, 'dim'));
    } else {
      console.log(out);
    }
  }

  const breaking = diff.changes.newlyFailing.length;
  if (breaking) process.exit(1);
}
