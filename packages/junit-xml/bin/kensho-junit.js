#!/usr/bin/env node
// kensho-junit — convert JUnit XML into kensho-results/.

import { convertJUnit } from '../index.js';

function parseArgs(argv) {
  const out = { inputs: [], output: 'kensho-results' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input' || a === '-i') {
      out.inputs.push(argv[++i]);
    } else if (a === '--output' || a === '-o') {
      out.output = argv[++i];
    } else if (a === '--project-name') {
      out.projectName = argv[++i];
    } else if (a === '--project-slug') {
      out.projectSlug = argv[++i];
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    } else if (!a.startsWith('-')) {
      out.inputs.push(a);
    }
  }
  return out;
}

const argv = parseArgs(process.argv.slice(2));

if (argv.help || argv.inputs.length === 0) {
  console.log(`Usage: kensho-junit --input <file.xml> [--input <file2.xml> …] [--output kensho-results] [--project-name <name>] [--project-slug <slug>]

Converts JUnit XML reports into a kensho-results/ bundle that the Kensho CLI
can turn into an HTML report:

    kensho-junit --input reports/junit.xml --output kensho-results
    npx kensho generate
    npx kensho open
`);
  process.exit(argv.help ? 0 : 1);
}

try {
  const res = convertJUnit(argv.inputs, argv.output, {
    project: { name: argv.projectName, slug: argv.projectSlug },
  });
  console.log(`[kensho-junit] ${res.cases} cases → ${res.outputDir}`);
} catch (e) {
  console.error('[kensho-junit] failed:', e && e.message);
  process.exit(2);
}
