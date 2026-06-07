#!/usr/bin/env node
// kensho — CLI entrypoint. Subcommands:
//   generate   read kensho-results/ → emit kensho-report/ (static site)
//   open       start a local server, open the report in a browser
//   validate   type-check kensho-results/ against the v1 schema
//   version    print version

import { generate } from '../src/generate.js';
import { openReport } from '../src/open.js';
import { validate } from '../src/validate.js';
import { renderBadge } from '../src/badge.js';
import { diffRuns } from '../src/diff.js';
import { loginCli } from '../src/login.js';
import { pushCli } from '../src/push.js';
import { watchCli } from '../src/watch.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'));

function parseFlags(argv, repeatable = []) {
  const flags = {};
  const positional = [];
  const repeat = new Set(repeatable);
  const set = (key, value) => {
    if (repeat.has(key)) {
      flags[key] = flags[key] ? [...flags[key], value] : [value];
    } else {
      flags[key] = value;
    }
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > -1) set(a.slice(2, eq), a.slice(eq + 1));
      else if (!argv[i + 1] || argv[i + 1].startsWith('--')) set(a.slice(2), true);
      else { set(a.slice(2), argv[++i]); }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function usage() {
  console.log(`kensho ${pkg.version}

Usage:
  kensho generate [--input <dir>] [--output <dir>] [--history <dir>] [--no-compress]
                  [--codeowners <path>] [--no-codeowners]
  kensho open     [--report <dir>]  [--port <n>]
  kensho validate [<dir>]
  kensho badge    [--input <dir>] [--type passrate|status|tests] [--out <file>]
  kensho diff     <prev-results-dir> <new-results-dir> [--out <dir>] [--no-terminal]
  kensho login    [--server <url>]
  kensho push     [--input <dir>] [--workspace <slug>] [--project <slug>]
                  [--token <token>] [--server <url>] [--label k=v]...
                  [--dry-run] [--no-attachments] [--quiet] [--force] [--strict]
  kensho watch    [--input <dir>] [--workspace <slug>] [--project <slug>]
                  [--token <token>] [--server <url>]
                  [--debounce-ms <n>] [--finalize-on-exit true|false] [--quiet]
  kensho version

Options:
  --input         Directory with kensho-results/ (default: ./kensho-results)
  --output        Directory for the generated static report (default: ./kensho-report)
  --history       Optional kensho-history/ directory with prior run.json files for trend/flake
  --config        Path to kensho.config.json (default: <input>/../kensho.config.json)
  --no-compress   Skip JSON minification + .gz companions (slower load, easier to debug)
  --codeowners    Path to a CODEOWNERS file (default: <repo-root>/.github/CODEOWNERS)
  --no-codeowners Skip CODEOWNERS owner inference
  --report        Directory to serve (default: ./kensho-report)
  --port          Port for 'open' (default: auto-select)
  --type          Badge type: passrate (default) | status | tests
  --out           For 'badge': write SVG to file. For 'diff': emit static HTML report into <dir>.
  --no-terminal   For 'diff': skip the terminal punch list (useful when only --out is wanted).

Examples:
  npx kensho generate
  npx kensho generate --input ./ci-output --output ./out
  npx kensho generate --no-compress --no-codeowners
  npx kensho open --report ./out --port 4000
  npx kensho badge --type passrate --out badge.svg
  npx kensho diff ./prev-results ./kensho-results
  npx kensho diff ./prev-results ./kensho-results --out ./kensho-diff
  npx kensho login
  npx kensho push --workspace acme-web
  npx kensho push --strict   # CI gate
  npx kensho watch --workspace acme-web   # stream a live run while tests execute
`);
}

function watchHelp() {
  console.log(`kensho watch — stream a live test run to the Kaizen platform

  Drives the live-run UI: as your test process writes case files into
  kensho-results/cases/, this command batches them and POSTs to the platform
  so the run paints in real time. On exit (or Ctrl-C) it sends a final
  finalize event with run.json + every case on disk.

Usage:
  kensho watch [--input <dir>] [--workspace <slug>] [--project <slug>]
               [--token <token>] [--server <url>]
               [--debounce-ms <n>] [--finalize-on-exit true|false] [--quiet]

Options:
  --input              kensho-results/ directory (default: ./kensho-results)
  --workspace <slug>   Kaizen workspace (or KAIZEN_WORKSPACE / saved auth)
  --project <slug>     Kaizen project   (or KAIZEN_PROJECT)
  --token <token>      Bearer token     (or KAIZEN_TOKEN / saved auth)
  --server <url>       Self-hosted base URL (default: https://api.kaizenreport.com)
  --debounce-ms <n>    Coalesce filesystem events for n ms (default: 200)
  --finalize-on-exit   Send /live/finalize on SIGINT/SIGTERM (default: true)
  --quiet              Suppress non-error output

Limitations:
  Attachments are not uploaded in live mode — only case-level metadata streams.
  Run \`kensho push\` after the test process completes if you need attachments
  in the report.
`);
}

const [, , cmd, ...rest] = process.argv;
const { flags, positional } = parseFlags(rest, ['label']);

(async () => {
  try {
    switch (cmd) {
      case 'generate': {
        const input = resolve(process.cwd(), flags.input || 'kensho-results');
        const output = resolve(process.cwd(), flags.output || 'kensho-report');
        const history = flags.history ? resolve(process.cwd(), flags.history) : null;
        const config = flags.config ? resolve(process.cwd(), flags.config) : null;
        const compress = !flags['no-compress'];
        const codeownersPath = flags.codeowners && flags.codeowners !== true
          ? resolve(process.cwd(), flags.codeowners) : null;
        const codeownersDisabled = !!flags['no-codeowners'];
        await generate({ input, output, history, config, compress, codeownersPath, codeownersDisabled });
        break;
      }
      case 'open': {
        const report = resolve(process.cwd(), flags.report || 'kensho-report');
        const port = flags.port ? parseInt(flags.port, 10) : 0;
        await openReport({ report, port });
        break;
      }
      case 'validate': {
        const input = resolve(process.cwd(), positional[0] || flags.input || 'kensho-results');
        const ok = await validate({ input });
        process.exit(ok ? 0 : 1);
      }
      case 'badge': {
        const input = resolve(process.cwd(), flags.input || 'kensho-results');
        const out = flags.out ? resolve(process.cwd(), flags.out) : null;
        await renderBadge({ input, type: flags.type || 'passrate', out });
        break;
      }
      case 'diff': {
        const prev = resolve(process.cwd(), positional[0] || 'kensho-results-prev');
        const cur  = resolve(process.cwd(), positional[1] || 'kensho-results');
        const out = flags.out ? resolve(process.cwd(), flags.out) : null;
        const terminal = !flags['no-terminal'];
        await diffRuns({ prev, cur, out, terminal });
        break;
      }
      case 'login': {
        if (flags.help || flags.h) { usage(); break; }
        const code = await loginCli({
          server: flags.server && flags.server !== true ? flags.server : undefined,
        });
        process.exit(code || 0);
      }
      case 'watch': {
        if (flags.help || flags.h) { watchHelp(); break; }
        const finalizeOnExit = flags['finalize-on-exit'] === true
          || flags['finalize-on-exit'] === undefined
          || /^true$/i.test(String(flags['finalize-on-exit']));
        const debounceMs = flags['debounce-ms'] && flags['debounce-ms'] !== true
          ? parseInt(flags['debounce-ms'], 10)
          : undefined;
        const code = await watchCli({
          input: flags.input && flags.input !== true ? flags.input : 'kensho-results',
          workspace: flags.workspace && flags.workspace !== true ? flags.workspace : undefined,
          project: flags.project && flags.project !== true ? flags.project : undefined,
          token: flags.token && flags.token !== true ? flags.token : undefined,
          server: flags.server && flags.server !== true ? flags.server : undefined,
          debounceMs,
          finalizeOnExit,
          quiet: !!flags.quiet,
        });
        process.exit(code);
      }
      case 'push': {
        if (flags.help || flags.h) { usage(); break; }
        const labels = Array.isArray(flags.label)
          ? flags.label
          : (flags.label && flags.label !== true ? [flags.label] : []);
        const code = await pushCli({
          input: flags.input && flags.input !== true ? flags.input : 'kensho-results',
          workspace: flags.workspace && flags.workspace !== true ? flags.workspace : undefined,
          project: flags.project && flags.project !== true ? flags.project : undefined,
          token: flags.token && flags.token !== true ? flags.token : undefined,
          server: flags.server && flags.server !== true ? flags.server : undefined,
          labels,
          dryRun: !!flags['dry-run'],
          noAttachments: !!flags['no-attachments'],
          quiet: !!flags.quiet,
          force: !!flags.force,
          strict: !!flags.strict,
        });
        process.exit(code);
      }
      case 'version':
      case '--version':
      case '-v':
        console.log(pkg.version);
        break;
      default:
        usage();
        if (cmd) process.exit(1);
    }
  } catch (err) {
    console.error('[kensho]', err.message || err);
    if (process.env.KENSHO_DEBUG) console.error(err.stack);
    process.exit(1);
  }
})();
