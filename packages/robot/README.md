# kensho-robot

A Robot Framework Listener (v3) that emits the canonical [Kensho v1](../schema)
JSON format. Run your tests, then point the `kensho` CLI at `kensho-results/`
to get a self-contained static HTML report.

## Install

```bash
pip install kensho-robot
# or, in this monorepo:
pip install -e packages/robot
```

## Run

```bash
robot --listener kensho_robot.Listener tests/
# => kensho-results/run.json + kensho-results/cases/*.json

# Generate the HTML report (uses the JS CLI from the same monorepo):
npx kensho generate
npx kensho open
```

Pass listener options after a colon:

```bash
robot --listener kensho_robot.Listener:output=kensho-results:project_name=Demo tests/
```

| Option                     | Default              | Effect                                            |
| -------------------------- | -------------------- | ------------------------------------------------- |
| `output=<dir>`             | `kensho-results`     | Output directory.                                 |
| `project_name=<name>`      | `Unknown project`    | Project name in `run.json`.                       |
| `project_slug=<slug>`      | derived from name    | Project slug (lowercase, alnum + dash/underscore).|
| `run_id=<id>`              | `run_<timestamp>`    | Override the auto-generated run id.               |
| `severity_from_tags=true`  | `true`               | Map `@critical` / `@severity:critical` tags onto `case.severity`. Set to `false` to disable. |

## What it produces

- `kensho-results/run.json` — run manifest (project, env, totals, timing).
- `kensho-results/cases/<stableId>.json` — one file per Robot test.
- `kensho-results/attachments/<caseId>/...` — files registered via
  `kensho_robot.attach`.

Each case gets a **stable id** (`tc_<16 hex>`) hashed from its full name +
file path, so test history correlates across runs and across adapters
(JS, pytest, and Go all use the same FNV-1a-based hash).

## Listener hook → Kensho mapping

| Robot hook          | Effect                                                          |
| ------------------- | --------------------------------------------------------------- |
| `start_suite`       | Capture suite name + `Documentation` (used as `case.behavior.feature` for tests inside). |
| `start_test`        | Open a Kensho case scratch; harvest tags/severity/links/labels. |
| `start_keyword`     | Push a Kensho step. `[Setup]` / `[Teardown]` get `phase = setup/teardown`; library and user keywords get `action = group`. |
| `log_message`       | Append a `Log` message to the active step's `logs[]`.           |
| `end_keyword`       | Close the step with `status` and `duration` from Robot.         |
| `end_test`          | Finalize the case; map Robot `PASS`/`FAIL`/`SKIP` to Kensho `pass`/`fail`/`skip` (or `broken` if a setup/teardown keyword was the failure source). Write `cases/<id>.json`. |
| `end_suite` (top)   | Write `run.json` with totals and `env`.                         |

## Tags we read

Robot tags do double duty as Kensho metadata. Aliases all work; `@`-prefixes
are optional.

| Tag                                          | Effect                                                  |
| -------------------------------------------- | ------------------------------------------------------- |
| `@critical`, `@blocker`, `@normal`, `@minor`, `@trivial` | Sets `case.severity`.                                   |
| `@severity:critical`                         | Same as above, explicit form.                           |
| `@feature:Cart`                              | Sets `case.behavior.feature`.                           |
| `@epic:Checkout`                             | Sets `case.behavior.epic`.                              |
| `@scenario:HappyPath` / `@story:HappyPath`   | Sets `case.behavior.scenario`.                          |
| `@owner:alice`                               | Sets `case.owner`.                                      |
| `@label:team=growth`                         | Adds `case.labels.team = "growth"`.                     |
| `@link:https://…`                            | Adds a link to `case.links`.                            |
| `@link:jira=https://jira/PROJ-123`           | Same, with `kind`.                                      |
| `@link:jira=https://jira/PROJ-123=PROJ-123`  | Same, with `kind` and `label`.                          |
| Any other tag                                | Becomes a free-form `case.tags` chip.                   |

`*** Settings *** Documentation` on the suite becomes the default
`case.behavior.feature` for every test inside (override per-test with
`@feature:`).

`[Documentation]` on a test becomes `case.description`.

`[Template] My Keyword` records the template name in `case.parameters[]`.

## Helper API

Import the helpers from `kensho_robot`. All four are no-ops outside a
running test, so it's safe to call them from shared library code.

```python
import kensho_robot as kensho

def open_login_page():
    with kensho.step("warm up CDN"):
        ...
    with kensho.step("issue request"):
        ...

def attach_screenshot():
    kensho.attach("/tmp/screen.png", kind="screenshot")
    kensho.label("traffic", "synthetic")
    kensho.link("https://jira.example.com/browse/PROJ-123",
                kind="jira", label_text="PROJ-123")
```

| Helper                                                    | What it does                                          |
| --------------------------------------------------------- | ----------------------------------------------------- |
| `with kensho.step(title, action=None):`                   | Open a Kensho step nested under the active keyword. On exception, the step is marked `fail` and re-raised. |
| `kensho.attach(path, kind=None, name=None, mime_type=None)` | Copy the file into `kensho-results/attachments/<caseId>/` and register it on the current step (or case). |
| `kensho.label(key, value)`                                | Add a string label to the case.                       |
| `kensho.link(url, kind=None, label_text=None)`            | Add a hyperlink to the case.                          |
| `kensho.current_case_id()`                                | Returns the stable case id of the running test, or `None`. |

## Errors and broken vs fail

* `PASS` → `status: 'pass'`.
* `FAIL` from a test-body keyword → `status: 'fail'`. The Robot failure
  message becomes `case.errors[].message`; the full message goes into
  `case.errors[].stack`.
* `FAIL` whose source is a `[Setup]` or `[Teardown]` keyword →
  `status: 'broken'` (infrastructure, not a real assertion failure).
* `SKIP` / `NOT RUN` → `status: 'skip'`.
* Any other status (e.g. parse errors) → `status: 'broken'`.

## Environment auto-detected

GitHub Actions, CircleCI, GitLab CI, Jenkins, Buildkite, Azure DevOps —
CI provider, branch, commit, run URL, OS, architecture, Python version.

Pass `KR_AUTHOR`, `KR_COMMIT_MSG`, `KR_STAGE`, `KR_BASE_URL`,
`KR_APP_VERSION`, `KR_BUILD_NUMBER`, `KR_RELEASE`, `KR_REGION`,
`KR_LOCALE`, `KR_TRIGGER`, or `KR_FEATURE` as env vars to populate the
matching fields on `run.env`.

## Design notes

* Zero runtime dependencies beyond `robotframework`. The schema lives in
  the JS workspace; we vendor the minimum (id-hashing, status mapping,
  env capture) inline so the adapter installs in seconds.
* The listener never raises out of a hook — a broken adapter must not
  break a test run. All errors come out as `warnings.warn`.
* IDs are stable across adapters: the FNV-1a hash matches `kensho-pytest`,
  `kensho-go`, and the JS reporters byte-for-byte, so a test run on
  Robot rolls up to the same history as the same suite run elsewhere.

## License

Apache-2.0.
