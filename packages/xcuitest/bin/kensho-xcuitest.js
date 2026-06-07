#!/usr/bin/env node
// kensho-xcuitest — convert an .xcresult bundle (or its xcresulttool JSON dump)
// into kensho-results/.
//
//   kensho-xcuitest --input ./build/Test.xcresult --output ./kensho-results
//   kensho-xcuitest --input ./fixtures/sample.xcresult.json --output ./kensho-results
//
// Note: real .xcresult bundles require macOS + Xcode CLT (xcrun xcresulttool).

import { convert } from '../src/parser.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input' || a === '-i') out.input = argv[++i];
    else if (a === '--output' || a === '-o') out.output = argv[++i];
    else if (a === '--project-name') out.projectName = argv[++i];
    else if (a === '--project-slug') out.projectSlug = argv[++i];
    else if (a === '--run-id') out.runId = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.input) {
  console.log(`kensho-xcuitest

Usage:
  kensho-xcuitest --input <path> [--output kensho-results]
                  [--project-name "Acme iOS"] [--project-slug acme-ios]
                  [--run-id run_…]

Inputs:
  <path>         Either an .xcresult bundle or a JSON dump from xcresulttool.

Examples:
  xcodebuild -scheme AcmeUITests test -resultBundlePath ./out.xcresult
  kensho-xcuitest --input ./out.xcresult --output ./kensho-results
  kensho generate --input ./kensho-results --output ./kensho-report
`);
  process.exit(args.input ? 0 : 1);
}

try {
  convert({
    input: args.input,
    output: args.output || 'kensho-results',
    project: { name: args.projectName, slug: args.projectSlug },
    runId: args.runId,
  });
} catch (e) {
  console.error('[kensho-xcuitest]', e.message || e);
  if (process.env.KENSHO_DEBUG) console.error(e.stack);
  process.exit(1);
}
