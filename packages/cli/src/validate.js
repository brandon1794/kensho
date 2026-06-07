// kensho validate — type-check a kensho-results/ folder against the v1 schema.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { validateRun, computeTotals } from '@kaizenreport/kensho-schema';

export async function validate({ input }) {
  if (!existsSync(input)) {
    console.error(`[kensho] ${input} does not exist`);
    return false;
  }
  const runPath = join(input, 'run.json');
  if (!existsSync(runPath)) {
    console.error(`[kensho] missing run.json in ${relative(process.cwd(), input)}`);
    return false;
  }
  const run = JSON.parse(readFileSync(runPath, 'utf8'));

  const casesDir = join(input, 'cases');
  if (existsSync(casesDir)) {
    const byId = new Map(run.testCases.map(c => [c.id, c]));
    for (const f of readdirSync(casesDir).filter(n => n.endsWith('.json'))) {
      try {
        const c = JSON.parse(readFileSync(join(casesDir, f), 'utf8'));
        byId.set(c.id, c);
      } catch (e) {
        console.error(`[kensho] cases/${f}: ${e.message}`);
        return false;
      }
    }
    run.testCases = [...byId.values()];
  }
  run.totals = computeTotals(run.testCases);

  const { ok, errors } = validateRun(run);
  if (ok) {
    console.log(`[kensho] ✓ ${relative(process.cwd(), input)} is valid (${run.testCases.length} cases)`);
    return true;
  }
  console.error(`[kensho] ✗ ${errors.length} validation error(s) in ${relative(process.cwd(), input)}:`);
  for (const e of errors.slice(0, 20)) console.error('  -', e);
  if (errors.length > 20) console.error(`  … and ${errors.length - 20} more`);
  return false;
}
