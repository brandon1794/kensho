// kensho merge — union several kensho-results/ directories into one.
//
// Use when a single logical run is split across shards/projects (e.g. one
// CI job per browser, or per package in a monorepo) and you want one report.
//
//   kensho merge <dir...> --out <dir>
//
// Behaviour:
//   · testCases are unioned. A colliding id keeps the first occurrence and
//     suffixes later ones (`<id>_2`, `<id>_3`, …) so nothing is silently lost.
//   · attachments are copied into the merged tree and their relativePaths are
//     remapped when an id was suffixed.
//   · run meta is merged: earliest startedAt, latest finishedAt, summed
//     durationMs, totals recomputed from the unioned cases.
//   · the result passes validateRun.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync, cpSync } from 'node:fs';
import { join, resolve, sep, dirname } from 'node:path';
import { validateRun, computeTotals, emptyRun } from '@kaizenreport/kensho-schema';

// Load run.json + per-case JSONs from a results dir (full cases win).
function loadResults(dir) {
  const runPath = join(dir, 'run.json');
  if (!existsSync(runPath)) throw new Error(`missing run.json in ${dir}`);
  const run = JSON.parse(readFileSync(runPath, 'utf8'));
  if (!Array.isArray(run.testCases)) run.testCases = [];
  const casesDir = join(dir, 'cases');
  if (existsSync(casesDir)) {
    const byId = new Map(run.testCases.map(c => [c.id, c]));
    for (const f of readdirSync(casesDir).filter(n => n.endsWith('.json'))) {
      try {
        const c = JSON.parse(readFileSync(join(casesDir, f), 'utf8'));
        byId.set(c.id, c);
      } catch { /* skip unreadable case */ }
    }
    run.testCases = [...byId.values()];
  }
  return run;
}

// Copy a source dir's attachments/<id>/ tree into the merged output, honoring
// an id remap (when ids collided). Guards against path traversal in ids.
function copyAttachmentsFor(srcDir, outAttDir, idMap) {
  const srcAtt = join(srcDir, 'attachments');
  if (!existsSync(srcAtt)) return;
  for (const oldId of readdirSync(srcAtt)) {
    const from = join(srcAtt, oldId);
    let st;
    try { st = statSync(from); } catch { continue; }
    if (!st.isDirectory()) continue;
    const newId = idMap.get(oldId) || oldId;
    if (newId.includes('/') || newId.includes('\\') || newId.includes('..')) continue;
    const to = join(outAttDir, newId);
    cpSync(from, to, { recursive: true });
  }
}

// Remap a case's attachment relativePaths from attachments/<oldId>/ to
// attachments/<newId>/ when the id changed.
function remapAttachmentPaths(c, oldId, newId) {
  if (oldId === newId || !Array.isArray(c.attachments)) return;
  const from = `attachments/${oldId}/`;
  const to = `attachments/${newId}/`;
  for (const a of c.attachments) {
    if (typeof a.relativePath === 'string' && a.relativePath.startsWith(from)) {
      a.relativePath = to + a.relativePath.slice(from.length);
    }
  }
}

function earliestIso(a, b) {
  if (!a) return b; if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}
function latestIso(a, b) {
  if (!a) return b; if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

export async function mergeResults({ inputs, out }) {
  if (!Array.isArray(inputs) || inputs.length < 1) {
    throw new Error('merge needs at least one input directory');
  }
  if (!out) throw new Error('merge requires --out <dir>');

  const runs = inputs.map(d => ({ dir: resolve(d), run: loadResults(resolve(d)) }));

  // Seed run meta from the first source, then fold the rest in.
  const base = runs[0].run;
  const merged = emptyRun({
    id: base.id,
    project: base.project,
    framework: base.framework,
    env: base.env,
    startedAt: base.startedAt,
  });
  merged.finishedAt = base.finishedAt;
  merged.durationMs = 0;
  if (base.links) merged.links = [...base.links];
  if (base.categories) merged.categories = [...base.categories];

  const seen = new Map();          // id -> count (for suffixing)
  const cases = [];

  for (const { dir, run } of runs) {
    merged.startedAt = earliestIso(merged.startedAt, run.startedAt);
    merged.finishedAt = latestIso(merged.finishedAt, run.finishedAt);
    merged.durationMs += run.durationMs || 0;

    const idMap = new Map();       // oldId -> newId for this source's attachments
    for (const c of run.testCases) {
      const oldId = c.id;
      let newId = oldId;
      if (seen.has(oldId)) {
        const n = seen.get(oldId) + 1;
        seen.set(oldId, n);
        newId = `${oldId}_${n}`;
      } else {
        seen.set(oldId, 1);
      }
      const copy = { ...c, id: newId };
      remapAttachmentPaths(copy, oldId, newId);
      idMap.set(oldId, newId);
      cases.push(copy);
    }
    // stash for attachment copy after output dir exists
    run.__idMap = idMap;
    run.__dir = dir;
  }

  merged.testCases = cases;
  merged.totals = computeTotals(cases);

  // --- write output tree ---
  mkdirSync(out, { recursive: true });
  const outCases = join(out, 'cases');
  mkdirSync(outCases, { recursive: true });
  for (const c of cases) {
    writeFileSync(join(outCases, c.id + '.json'), JSON.stringify(c, null, 2));
  }
  // run.json carries summaries; keep the full case list too (consumers that
  // don't read cases/ still see everything).
  writeFileSync(join(out, 'run.json'), JSON.stringify(merged, null, 2));

  const outAtt = join(out, 'attachments');
  let copiedAtt = false;
  for (const { run } of runs) {
    if (existsSync(join(run.__dir, 'attachments'))) {
      if (!copiedAtt) { mkdirSync(outAtt, { recursive: true }); copiedAtt = true; }
      copyAttachmentsFor(run.__dir, outAtt, run.__idMap);
    }
  }

  const { ok, errors } = validateRun(merged);
  const t = merged.totals;
  console.log(`[kensho] ✓ merged ${runs.length} run${runs.length === 1 ? '' : 's'} → ${cases.length} cases · pass ${t.pass} · fail ${t.fail} · broken ${t.broken} · skip ${t.skip}`);
  console.log(`[kensho] ✓ written to ${out}/`);
  if (!ok) {
    console.warn(`[kensho] ⚠ merged run has ${errors.length} validation issue(s):`);
    for (const e of errors.slice(0, 8)) console.warn('  -', e);
    return 1;
  }
  return 0;
}
