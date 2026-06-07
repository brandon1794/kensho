#!/usr/bin/env node
// kensho-go — convert `go test -json` output into kensho-results/.
//
//   go test -json ./... | npx kensho-go --output kensho-results
//   npx kensho-go --input gotest.json --output kensho-results
//
// Then:
//
//   npx kensho generate
//   npx kensho open

import { convertGoEvents, readEvents, readEventsFromStream } from '../src/index.js';

function parseArgs(argv) {
  const out = {
    inputs: [],
    output: 'kensho-results',
    subtests: 'cases',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input' || a === '-i') out.inputs.push(argv[++i]);
    else if (a === '--output' || a === '-o') out.output = argv[++i];
    else if (a === '--project-name') out.projectName = argv[++i];
    else if (a === '--project-slug') out.projectSlug = argv[++i];
    else if (a === '--run-id') out.runId = argv[++i];
    else if (a.startsWith('--subtests=')) out.subtests = a.slice('--subtests='.length);
    else if (a === '--subtests') out.subtests = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else if (!a.startsWith('-')) out.inputs.push(a);
  }
  return out;
}

const argv = parseArgs(process.argv.slice(2));

if (argv.help) {
  console.log(`Usage: kensho-go [--input <file>] [--output kensho-results]
                 [--project-name <name>] [--project-slug <slug>]
                 [--run-id <id>] [--subtests cases|children]

Reads \`go test -json\` events and writes a kensho-results/ bundle.

Common flows:

  go test -json ./... | npx kensho-go --output kensho-results
  npx kensho-go --input gotest.json --output kensho-results

Options:
  --input, -i        Path to a file with go test -json output (omit to read stdin).
                     Pass --input multiple times to merge several files.
  --output, -o       Output directory (default: kensho-results).
  --project-name     Project name to embed in run.json (default: "Unknown project").
  --project-slug     Project slug (default: derived from name or "unknown").
  --run-id           Override the auto-generated run id.
  --subtests         "cases" (default) — every \`t.Run\` becomes its own Kensho case.
                     "children"        — sub-tests roll up as nested steps under the parent.

After conversion, render the report with the Kensho CLI:

  npx kensho generate
  npx kensho open
`);
  process.exit(0);
}

(async () => {
  let events;
  try {
    if (argv.inputs.length) {
      events = readEvents(argv.inputs.length === 1 ? argv.inputs[0] : argv.inputs);
    } else if (!process.stdin.isTTY) {
      events = await readEventsFromStream(process.stdin);
    } else {
      console.error('[kensho-go] no input. Pipe `go test -json` output in, or pass --input <file>.');
      process.exit(2);
    }
  } catch (e) {
    console.error('[kensho-go] failed to read input:', e && e.message);
    process.exit(2);
  }

  if (!events.length) {
    console.error('[kensho-go] no events parsed — is the input actually `go test -json` output?');
    process.exit(3);
  }

  try {
    const res = convertGoEvents({
      events,
      output: argv.output,
      project: { name: argv.projectName, slug: argv.projectSlug },
      runId: argv.runId,
      subtests: argv.subtests,
    });
    if (!res.valid) process.exit(4);
  } catch (e) {
    console.error('[kensho-go] conversion failed:', e && e.message);
    if (process.env.KENSHO_DEBUG) console.error(e.stack);
    process.exit(2);
  }
})();
