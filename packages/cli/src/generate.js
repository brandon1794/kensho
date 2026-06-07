// kensho generate — read kensho-results/ + history → emit kensho-report/
//
// What this writes:
//   kensho-report/
//     index.html                 (shell loaded by the user)
//     assets/                    (viewer JS + CSS, copied from kensho-viewer pkg)
//     data/
//       index.json               (run manifest + case summary + history summary, minified)
//       index.json.gz            (gzipped companion for CDN deployments)
//       cases/<id>.json          (full per-case data, lazy-loaded by the viewer)
//       cases/<id>.json.gz       (gzipped companion)
//       attachments/<id>/...     (copied as-is from kensho-results)

import { readFileSync, writeFileSync, readdirSync, mkdirSync, cpSync, existsSync, statSync } from 'node:fs';
import { resolve, join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { validateRun, computeTotals } from '@kaizenreport/kensho-schema';
import { loadCodeowners, ownersForPath } from './codeowners.js';

const require = createRequire(import.meta.url);

export async function generate({ input, output, history, config: configPath, compress = true, codeownersPath, codeownersDisabled = false }) {
  const started = Date.now();
  if (!existsSync(input)) throw new Error(`input directory not found: ${input}`);

  console.log(`[kensho] generating from ${relative(process.cwd(), input)}`);

  // --- 0. Load kensho.config.json if present -----------------------------
  const config = loadConfig(configPath || join(input, '..', 'kensho.config.json'));

  // --- 1. Load run.json --------------------------------------------------
  const runJsonPath = join(input, 'run.json');
  if (!existsSync(runJsonPath)) throw new Error(`missing run.json in ${input}`);
  const run = JSON.parse(readFileSync(runJsonPath, 'utf8'));

  // --- 2. Load per-case JSONs (if present) to enrich run.testCases -------
  const casesDir = join(input, 'cases');
  let caseFiles = [];
  if (existsSync(casesDir)) {
    caseFiles = readdirSync(casesDir).filter(f => f.endsWith('.json'));
    const byId = new Map(run.testCases.map(c => [c.id, c]));
    for (const f of caseFiles) {
      try {
        const full = JSON.parse(readFileSync(join(casesDir, f), 'utf8'));
        byId.set(full.id, full);
      } catch { /* skip */ }
    }
    run.testCases = [...byId.values()];
  }
  run.totals = computeTotals(run.testCases);

  // --- 2b. CODEOWNERS fallback ------------------------------------------
  // Resolve a per-case owner from .github/CODEOWNERS when the adapter didn't
  // supply one. We walk *upward* from the input dir until we hit a marker
  // (.git or package.json) so users running `kensho generate` from sub-dirs
  // (monorepos) still get their root-level CODEOWNERS picked up.
  const repoRoot = findRepoRoot(input);
  const co = loadCodeowners({
    repoRoot,
    explicitPath: codeownersPath || null,
    disable: codeownersDisabled,
  });
  let codeownersHits = 0;
  if (co.rules.length > 0) {
    for (const c of run.testCases) {
      if (c.owner) continue;
      const owners = ownersForPath(c.filePath, co.rules);
      if (owners?.length) {
        c.owner = owners[0];
        codeownersHits++;
      }
    }
  }

  // --- 3. Validate against schema ---------------------------------------
  const { ok, errors } = validateRun(run);
  if (!ok) {
    console.warn('[kensho] run failed validation (continuing anyway):');
    for (const e of errors.slice(0, 8)) console.warn('  -', e);
  }

  // --- 4. Load history (previous run.json files, last 20) ---------------
  const historyRuns = history && existsSync(history) ? loadHistory(history).slice(0, 20) : [];

  // --- 5. Write the output tree -----------------------------------------
  mkdirSync(output, { recursive: true });
  mkdirSync(join(output, 'data', 'cases'), { recursive: true });

  // Per-case JSON (lazy-loaded by the viewer). Minified — saves ~50% on
  // whitespace-heavy cases. Optional gzip companion for S3/CDN.
  let casesBytesRaw = 0, casesBytesGz = 0;
  for (const c of run.testCases) {
    const j = compress ? JSON.stringify(c) : JSON.stringify(c, null, 2);
    const out = join(output, 'data', 'cases', c.id + '.json');
    writeFileSync(out, j);
    casesBytesRaw += Buffer.byteLength(j);
    if (compress) {
      const gz = gzipSync(j);
      writeFileSync(out + '.gz', gz);
      casesBytesGz += gz.length;
    }
  }

  // index.json — the viewer's boot manifest. Summarizes the run without
  // carrying every step/log so the first paint is fast.
  const indexJson = {
    schemaVersion: 'kensho/v1',
    runId: run.id,
    project: Object.assign({}, run.project, config.project || {}),
    framework: run.framework,
    env: run.env,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    totals: run.totals,
    links: run.links,
    generatedAt: new Date().toISOString(),
    generatedByVersion: 'kensho-cli/0.1.0',
    config,
    cases: run.testCases.map(c => ({
      id: c.id, name: c.name, fullName: c.fullName, filePath: c.filePath,
      line: c.line,
      suite: c.suite, tags: c.tags, severity: c.severity, owner: c.owner,
      status: c.status, duration: c.duration, startedAt: c.startedAt,
      browser: c.browser, worker: c.worker, retries: c.retries, retryOf: c.retryOf,
      behavior: c.behavior,
      labels: c.labels,
      links: c.links,
      // First error message preview — lets the Overview + Categories pages
      // categorize and show meaningful previews without reading every case.
      errorType: c.errors?.[0]?.type,
      errorPreview: (c.errors?.[0]?.message || '').slice(0, 280),
      hasErrors: (c.errors || []).length > 0,
      attachmentCount: (c.attachments || []).length,
      stepCount: (c.steps || []).length,
    })),
    history: historyRuns.map(h => ({
      id: h.id, startedAt: h.startedAt, finishedAt: h.finishedAt,
      totals: h.totals, durationMs: h.durationMs,
      commit: h.env?.commit, branch: h.env?.branch,
    })),
  };
  const indexStr = compress ? JSON.stringify(indexJson) : JSON.stringify(indexJson, null, 2);
  const indexPathOut = join(output, 'data', 'index.json');
  writeFileSync(indexPathOut, indexStr);
  let indexGzBytes = 0;
  if (compress) {
    const gz = gzipSync(indexStr);
    writeFileSync(indexPathOut + '.gz', gz);
    indexGzBytes = gz.length;
  }

  // Copy attachments — preserving the relative layout under data/attachments/
  const attSrc = join(input, 'attachments');
  if (existsSync(attSrc)) {
    cpSync(attSrc, join(output, 'data', 'attachments'), { recursive: true });
  }

  // --- 6. Copy viewer assets (HTML shell + JS + CSS) --------------------
  // The viewer ships pre-compiled .js next to its .jsx sources (run
  // `pnpm --filter @kaizenreport/kensho-viewer build`). We try once at
  // generate time as a safety net so a fresh checkout still works.
  const viewerDir = findViewerDir();
  ensureViewerBuilt(viewerDir);

  cpSync(viewerDir, output, {
    recursive: true,
    filter: (src) => {
      const b = src.split(/[\\/]/).pop();
      // Skip package metadata + dev-only build script + node_modules.
      if (b === 'package.json' || b === 'node_modules' || b === 'README.md' || b === 'scripts') return false;
      return true;
    },
  });

  // Rewrite the title in index.html to include project + totals.
  const indexPath = join(output, 'index.html');
  if (existsSync(indexPath)) {
    const html = readFileSync(indexPath, 'utf8')
      .replace(/<title>[^<]*<\/title>/, `<title>${esc(run.project.name)} · Kensho report</title>`);
    writeFileSync(indexPath, html);
  }

  const ms = Date.now() - started;
  const size = dirSize(output);
  console.log(
    `[kensho] ✓ ${run.testCases.length} cases · pass ${run.totals.pass} · fail ${run.totals.fail} · flaky ${run.totals.flaky || 0} · skip ${run.totals.skip}`,
  );
  if (compress) {
    const indexLine = `index.json ${formatBytes(Buffer.byteLength(indexStr))} · gzipped ${formatBytes(indexGzBytes)}`;
    const casesLine = `cases ${run.testCases.length}× → ${formatBytes(casesBytesRaw)} · gzipped ${formatBytes(casesBytesGz)}`;
    console.log(`[kensho] ✓ ${indexLine}`);
    console.log(`[kensho] ✓ ${casesLine}`);
  } else {
    console.log(`[kensho] ✓ index.json ${formatBytes(Buffer.byteLength(indexStr))} · cases ${run.testCases.length}× → ${formatBytes(casesBytesRaw)} (uncompressed)`);
  }
  if (co.file) {
    console.log(`[kensho] ✓ CODEOWNERS · ${relative(process.cwd(), co.file)} · ${codeownersHits} test${codeownersHits === 1 ? '' : 's'} matched`);
  }
  console.log(
    `[kensho] ✓ report written to ${relative(process.cwd(), output)}/ (${formatBytes(size)} · ${ms} ms)`,
  );
  console.log(`[kensho] → open with:  npx kensho open --report ${relative(process.cwd(), output)}`);
}

function esc(s) { return String(s).replace(/[<>]/g, m => m === '<' ? '&lt;' : '&gt;'); }

// kensho.config.json lets teams customize branding, visible tabs, severity
// labels, and failure categories without forking the viewer.
function loadConfig(configPath) {
  const defaults = {
    brand: {
      name: 'Kensho',
      tagline: 'Report',
      accent: null,      // override --kv-accent
      logoUrl: null,     // inline SVG or external URL; if null, uses KaizenReport mark
    },
    tabs: {
      overview:    true,
      suites:      true,
      categories:  true,
      graphs:      true,
      timeline:    true,
      behaviors:   true,
      environment: true,
    },
    project: {},         // override index.project.{name,slug,url}
    categories: null,    // array of { name, matchMessage (regex str) } — overrides auto-categorize
    redact: [],          // array of regex strings applied to parameters + env vars
  };
  if (!configPath || !existsSync(configPath)) return defaults;
  try {
    const user = JSON.parse(readFileSync(configPath, 'utf8'));
    return {
      ...defaults, ...user,
      brand: { ...defaults.brand, ...(user.brand || {}) },
      tabs:  { ...defaults.tabs,  ...(user.tabs  || {}) },
      project: user.project || defaults.project,
    };
  } catch (e) {
    console.warn('[kensho] config load failed, using defaults:', e.message);
    return defaults;
  }
}

function findViewerDir() {
  // packages/cli/src/generate.js → packages/viewer/
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const direct = resolve(__dirname, '..', '..', 'viewer');
  if (existsSync(direct)) return direct;
  try {
    const pkgPath = require.resolve('@kaizenreport/kensho-viewer/package.json');
    return dirname(pkgPath);
  } catch {
    throw new Error('@kaizenreport/kensho-viewer package not found');
  }
}

// Make sure the viewer's .jsx → .js artifacts exist before we copy them.
// We check for a single representative output (data-bridge.js); if it's
// missing OR older than the .jsx source, run the build once.
function ensureViewerBuilt(viewerDir) {
  const assets = join(viewerDir, 'assets');
  if (!existsSync(assets)) return;
  const jsxFiles = readdirSync(assets).filter(f => f.endsWith('.jsx'));
  let needsBuild = false;
  for (const f of jsxFiles) {
    const jsx = join(assets, f);
    const js  = join(assets, f.replace(/\.jsx$/, '.js'));
    if (!existsSync(js)) { needsBuild = true; break; }
    if (statSync(jsx).mtimeMs > statSync(js).mtimeMs) { needsBuild = true; break; }
  }
  if (!needsBuild) return;

  const buildScript = join(viewerDir, 'scripts', 'build.js');
  if (!existsSync(buildScript)) return;
  console.log('[kensho] building viewer assets…');
  const r = spawnSync(process.execPath, [buildScript], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.warn('[kensho] viewer build failed; copying .jsx as fallback');
  }
}

function loadHistory(historyDir) {
  const entries = readdirSync(historyDir)
    .map(name => {
      const p = join(historyDir, name, 'run.json');
      if (!existsSync(p)) return null;
      try { return JSON.parse(readFileSync(p, 'utf8')); }
      catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.finishedAt || b.startedAt) - new Date(a.finishedAt || a.startedAt));
  return entries;
}

// Walk up from `start` looking for a repo marker (.git, package.json, or
// pnpm-workspace.yaml). Falls back to the input dir's parent if nothing is
// found, which is still a sensible place to look for a CODEOWNERS file.
function findRepoRoot(start) {
  let cur = resolve(start);
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(cur, '.git')) ||
        existsSync(join(cur, 'package.json')) ||
        existsSync(join(cur, 'pnpm-workspace.yaml'))) {
      return cur;
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return resolve(start, '..');
}

function dirSize(p) {
  let total = 0;
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      const s = statSync(full);
      if (s.isDirectory()) walk(full);
      else total += s.size;
    }
  };
  walk(p);
  return total;
}

function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}
