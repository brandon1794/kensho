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

## Library API

The CLI subcommands are also exported as functions so other tools can embed
them:

```js
import { push } from '@kaizenreport/kensho/src/push.js';
import { login } from '@kaizenreport/kensho/src/login.js';
```

Both return structured results (no `process.exit`) — handy for tests.
