// Minimal CODEOWNERS parser + matcher.
// Supports the subset of GitHub CODEOWNERS that's actually load-bearing for
// resolving an owner from a `filePath`:
//   · `*` and `**` glob segments
//   · `/`-prefix to anchor at repo root
//   · trailing `/` to mean "this directory and everything below"
//   · multiple owners per line (space- or tab-separated)
//   · last-match-wins per the GitHub spec
//   · comments (`#`) and blank lines
// Owners are returned as the literal token (e.g. "@user", "@org/team",
// "noreply@example.com"). The viewer renders whatever string we set.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function findCodeownersFile(repoRoot) {
  const candidates = [
    join(repoRoot, '.github', 'CODEOWNERS'),
    join(repoRoot, 'CODEOWNERS'),
    join(repoRoot, 'docs', 'CODEOWNERS'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function parseCodeowners(text) {
  const rules = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const tokens = line.split(/\s+/);
    if (tokens.length < 2) continue;
    const [pattern, ...owners] = tokens;
    const re = patternToRegex(pattern);
    if (!re) continue;
    rules.push({ pattern, owners, re });
  }
  return rules;
}

// Glob → regex. Handles the CODEOWNERS-flavored subset:
//   `*`     → any chars except `/`
//   `**`    → any chars including `/`
//   `?`     → single char except `/`
//   leading `/` → anchor at root
//   no leading `/` → match anywhere in the path (any prefix)
//   trailing `/` → directory match (anything inside)
function patternToRegex(pattern) {
  if (!pattern) return null;
  let p = pattern;
  let anchored = false;
  if (p.startsWith('/')) { anchored = true; p = p.slice(1); }
  const dir = p.endsWith('/');
  if (dir) p = p.slice(0, -1);

  // Escape regex metachars *except* the glob ones we'll re-handle below.
  let out = '';
  let i = 0;
  while (i < p.length) {
    const ch = p[i];
    if (ch === '*' && p[i + 1] === '*') { out += '.*'; i += 2; continue; }
    if (ch === '*') { out += '[^/]*'; i += 1; continue; }
    if (ch === '?') { out += '[^/]'; i += 1; continue; }
    if ('.+()|^$[]{}\\'.includes(ch)) { out += '\\' + ch; i += 1; continue; }
    out += ch;
    i += 1;
  }

  // Build the final regex.
  //   anchored + dir   → ^pattern(/.*)?$
  //   anchored + file  → ^pattern$
  //   loose    + dir   → (^|/)pattern(/.*)?$
  //   loose    + file  → (^|/)pattern$
  const head = anchored ? '^' : '(^|/)';
  const tail = dir ? '(/.*)?$' : '$';
  return new RegExp(head + out + tail);
}

// Last-match-wins: walk rules top-to-bottom, return the LAST one that matches.
export function ownersForPath(filePath, rules) {
  if (!filePath || !rules?.length) return null;
  // Normalize Windows paths and strip leading `./`.
  const norm = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  let last = null;
  for (const r of rules) {
    if (r.re.test(norm)) last = r;
  }
  return last ? last.owners : null;
}

// One-shot helper used by generate.js.
export function loadCodeowners({ repoRoot, explicitPath, disable }) {
  if (disable) return { rules: [], file: null };
  const file = explicitPath || findCodeownersFile(repoRoot);
  if (!file || !existsSync(file)) return { rules: [], file: null };
  try {
    const rules = parseCodeowners(readFileSync(file, 'utf8'));
    return { rules, file };
  } catch (e) {
    return { rules: [], file: null, error: e.message };
  }
}
