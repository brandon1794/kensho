// kensho diff — static HTML emitter.
//
// Writes a self-contained kensho-diff/ directory:
//   index.html
//   data/diff.json
//   assets/diff.js
//   assets/diff.css
//   assets/tokens.css            (copied from @kaizenreport/kensho-viewer)
//   assets/colors_and_type.css   (copied from @kaizenreport/kensho-viewer)
//   assets/kaizen-mark.svg       (copied from @kaizenreport/kensho-viewer)

import { writeFileSync, mkdirSync, cpSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export async function writeDiffSite(diff, { out }) {
  const outDir = resolve(out);
  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, 'data'), { recursive: true });
  mkdirSync(join(outDir, 'assets'), { recursive: true });

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const shellDir = resolve(__dirname, 'diff-assets');

  // index.html — verbatim
  cpSync(join(shellDir, 'index.html'), join(outDir, 'index.html'));
  // diff.css + diff.js → assets/
  cpSync(join(shellDir, 'diff.css'), join(outDir, 'assets', 'diff.css'));
  cpSync(join(shellDir, 'diff.js'), join(outDir, 'assets', 'diff.js'));

  // tokens.css + colors_and_type.css + kaizen-mark.svg from the viewer pkg.
  const viewerAssets = findViewerAssetsDir();
  for (const f of ['tokens.css', 'colors_and_type.css', 'kaizen-mark.svg']) {
    const src = join(viewerAssets, f);
    if (existsSync(src)) cpSync(src, join(outDir, 'assets', f));
  }

  writeFileSync(join(outDir, 'data', 'diff.json'), JSON.stringify(diff, null, 2));

  return outDir;
}

function findViewerAssetsDir() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const direct = resolve(__dirname, '..', '..', 'viewer', 'assets');
  if (existsSync(direct)) return direct;
  try {
    const pkgPath = require.resolve('@kaizenreport/kensho-viewer/package.json');
    return join(dirname(pkgPath), 'assets');
  } catch {
    throw new Error('@kaizenreport/kensho-viewer assets not found');
  }
}
