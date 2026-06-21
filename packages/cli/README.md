# `@kaizenreport/kensho`

The Kensho CLI. Reads `kensho-results/`, writes a beautiful static report,
and (optionally) uploads runs to the Kaizen platform.

```bash
npm i -D @kaizenreport/kensho
```

## Subcommands

| Command | Purpose |
|---|---|
| `kensho generate` | `kensho-results/` → `kensho-report/` (static site). |
| `kensho open`     | Local server + browser open for the generated report. |
| `kensho validate` | Schema-check `kensho-results/` against `kensho/v1`. |
| `kensho badge`    | SVG badge (passrate / status / tests). |
| `kensho diff`     | Compare two `kensho-results/` directories. |
| `kensho merge`    | Union several `kensho-results/` dirs into one (sharded/monorepo runs). |
| `kensho import-allure` | Convert an `allure-results/` directory to Kensho v1. |
| `kensho summary`  | Markdown digest (totals + top-10 failures) for PRs / CI summaries. |
| `kensho export-junit` | Emit a JUnit XML report from `kensho-results/`. |
| `kensho login`    | Browser sign-in; persists creds for `kensho push`. |
| `kensho push`     | Upload a run to the Kaizen platform. |
| `kensho watch`    | Stream a *live* run to the platform as case files land on disk. |

Run `kensho` (no args) for the full flag list.

---

## Push to Kaizen

Three lines of setup, then one extra line in CI.

### 1. Sign in once locally

```bash
npx kensho login
```

This opens `https://app.kaizenreport.com/cli/auth?…` in your browser, you pick
a workspace, and the CLI persists the token to `~/.config/kensho/auth.json`
with mode `0600`.

### 2. Push from CI (or locally)

```bash
npx kensho push                            # uses defaults from auth.json
npx kensho push --workspace acme-web       # explicit workspace
npx kensho push --strict                   # CI gate: exit code = regressions
```

### 3. CI-friendly token (no browser available)

If your CI runner can't open a browser, generate a workspace token from
`Settings → API keys` in the web app and pass it via env:

```bash
KAIZEN_TOKEN=kz_acme_...   \
KAIZEN_WORKSPACE=acme-web  \
KAIZEN_PROJECT=web         \
npx kensho push
```

### `kensho push` flags

| Flag | Default | Purpose |
|---|---|---|
| `--input <dir>`         | `kensho-results`                | results directory |
| `--workspace <slug>`    | from `kensho.config.json` / `KAIZEN_WORKSPACE` / saved auth | target workspace |
| `--project <slug>`      | from `run.json` `project.slug` / `kensho.config.json` / `KAIZEN_PROJECT` | target project |
| `--token <token>`       | `KAIZEN_TOKEN` / saved auth     | bearer token |
| `--server <url>`        | `https://api.kaizenreport.com`  | self-hosted base URL |
| `--label k=v`           | (repeatable)                    | extra `run.env.vars` injected at upload |
| `--dry-run`             | false                           | validate + print, don't upload |
| `--no-attachments`      | false                           | metadata-only push |
| `--quiet`               | false                           | machine-friendly output |
| `--force`               | false                           | upload even if local validation fails |
| `--strict`              | false                           | exit code = `summary.regressions` on success |

### Exit codes

| Code | Meaning |
|---|---|
| `0` | success |
| `1` | local schema validation failed (or other input error) |
| `2` | auth failure (no token / 401 / 403) |
| `3` | upload failure (init / PUT / finalize) |
| `n` | with `--strict`: `n = summary.regressions` |

### Idempotency

Pushing the same `(workspace, project, runId)` twice is a no-op — the API
returns the existing `internalRunId` + `runUrl` and the CLI just prints them.
Re-runs of the same CI workflow get the same `runId` so retries don't create
duplicates.

---

## Watch a live run

`kensho push` is a one-shot upload after your tests finish. `kensho watch` is the
opposite — it streams case results to the platform as they land on disk so you
can see the run paint in real time in the Kaizen UI.

```bash
# In one terminal: start the watcher BEFORE you run the test process.
npx kensho watch \
  --workspace acme-web \
  --project web \
  --token kz_…              # or KAIZEN_TOKEN / saved auth

# In another terminal (or the same CI step, backgrounded): run the tests.
npx playwright test
```

The watcher:

1. POSTs `/v1/ingest/kensho/live/start` to open a channel for this `runId`.
2. Watches `kensho-results/cases/` for new/changed `*.json` files using
   Node's built-in recursive `fs.watch`. Filesystem events are debounced
   (default **200 ms**) and batched into a single `/v1/ingest/kensho/live/event`
   POST per tick.
3. On `Ctrl-C` / `SIGINT` / `SIGTERM` (or when the test process exits and
   you `kill` the watcher), POSTs `/v1/ingest/kensho/live/finalize` with the
   final `run.json` + every `cases/*.json` on disk.

### `kensho watch` flags

| Flag | Default | Purpose |
|---|---|---|
| `--input <dir>`            | `kensho-results`               | results directory to watch |
| `--workspace <slug>`       | from `kensho.config.json` / `KAIZEN_WORKSPACE` / saved auth | target workspace |
| `--project <slug>`         | from `kensho.config.json` / `KAIZEN_PROJECT` | target project |
| `--token <token>`          | `KAIZEN_TOKEN` / saved auth    | bearer token |
| `--server <url>`           | `https://api.kaizenreport.com` | self-hosted base URL |
| `--debounce-ms <n>`        | `200`                          | coalesce filesystem events for n ms |
| `--finalize-on-exit`       | `true`                         | send `/live/finalize` on SIGINT/SIGTERM |
| `--quiet`                  | `false`                        | suppress non-error output |

### Limitations

- **Attachments are not uploaded in live mode.** Only case-level metadata
  streams through `/live/event`. If you need screenshots, videos, traces, etc.
  in the report, run `kensho push` after the test process finishes — that
  uses the existing `/init` + presigned-PUT path that already handles
  attachment dedup.
- If `kensho watch` is killed before any `run.json` lands on disk (e.g. the
  test process crashed mid-flight), it sends a synthesized minimal run with
  `abandoned: true` so the platform can mark the run accordingly.

---

## Failure enrichment at generate time

`kensho generate` enriches **failing** cases (`fail` / `broken`) before it
writes the report. Both passes are best-effort — they never fail the build:

- **Source snippets.** For each failure, Kensho locates the failing
  `filePath:line` (or the first in-repo frame in the error stack), reads ±6
  lines of context, and stores them on `case.sourceSnippet`. Files are
  resolved strictly inside the repo root (symlink/`..` escapes, missing files,
  files over 2 MB, and binaries are skipped). Pass `--no-snippets` to turn
  this off.
- **Failure categories.** Each failure gets a `case.category`. If a
  `kensho.config.json` (in the results dir or cwd) defines `categories` rules,
  the first matching rule wins:

  ```json
  {
    "categories": [
      { "name": "Flaky network", "matchedStatuses": ["fail"], "messageRegex": "ECONNRESET|502|timeout" },
      { "name": "Selector drift", "traceRegex": "locator|selector" }
    ]
  }
  ```

  Each rule may set `matchedStatuses`, `messageRegex`, and/or `traceRegex`.
  When no rule matches, Kensho auto-clusters by a normalized signature of the
  error message (digits, hex, quotes, paths, and UUIDs stripped) into shared
  buckets like *Timeout*, *Network*, *Assertion*, *Element not found*, etc.

`category`, `flaky`, and `muted` are carried into `data/index.json` so the
viewer's Categories / Flaky boards work without reading every case file.

---

## Merge sharded runs — `kensho merge`

```bash
kensho merge ./results-chromium ./results-firefox ./results-webkit --out ./kensho-results
```

Unions every input's test cases into one results tree. Colliding case ids keep
the first occurrence and suffix later ones (`<id>_2`, `<id>_3`, …); their
attachments are copied and `relativePath`s remapped. Run metadata is folded
together (earliest `startedAt`, latest `finishedAt`, summed `durationMs`,
recomputed totals). The output passes `kensho validate`, so you can pipe it
straight into `generate` or `push`.

## Import from Allure — `kensho import-allure`

```bash
kensho import-allure ./allure-results --out ./kensho-results
```

Converts an `allure-results/` directory (the `*-result.json` files) to Kensho
v1. Status, `statusDetails`, recursive steps, labels (epic/feature/story →
behavior; severity/owner/tag/suite), links (issue/tms/link), parameters, and
attachments (copied by basename) are all mapped. Case ids use
`stableCaseId(fullName, filePath)` so imported runs correlate across history.

## PR / CI summary — `kensho summary`

```bash
kensho summary ./kensho-results                 # Markdown to stdout
kensho summary ./kensho-report --out summary.md # works on a generated report too
kensho summary ./kensho-results --format gh     # appends to $GITHUB_STEP_SUMMARY
```

Prints a totals table plus the top-10 failures (with category + a one-line
error preview). Accepts either a `kensho-results/` dir or a generated
`kensho-report/` dir. With `--format gh` and no `--out`, it appends to the
file in `$GITHUB_STEP_SUMMARY` so the digest shows up in the GitHub Actions job
summary; otherwise it prints to stdout.

## Export JUnit XML — `kensho export-junit`

```bash
kensho export-junit ./kensho-results --out ./junit.xml
```

Emits a standard `<testsuites>/<testsuite>/<testcase>` document for any JUnit
consumer (GitLab, Jenkins, Bitbucket, GitHub reporters). `fail` → `<failure>`,
`broken` → `<error>`, `skip` → `<skipped>`. All content is XML-escaped, stacks
go in CDATA (with `]]>` split safely), and control characters are stripped so
the document is always well-formed.

---

## Library API

The CLI subcommands are also exported as functions so other tools can embed
them:

```js
import { push } from '@kaizenreport/kensho/src/push.js';
import { login } from '@kaizenreport/kensho/src/login.js';
```

Both return structured results (no `process.exit`) — handy for tests.
