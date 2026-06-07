# kensho-pytest

A pytest plugin that emits the canonical [Kensho v1](../schema) JSON format.
Run your tests, then point the `kensho` CLI at `kensho-results/` to get a
self-contained static HTML report.

## Install

```bash
pip install kensho-pytest
# or, in this monorepo:
pip install -e packages/pytest
```

The plugin auto-registers via the `pytest11` entry point — no `conftest.py`
edits required.

## Run

```bash
pytest
# => kensho-results/run.json + kensho-results/cases/*.json

# Generate the HTML report (uses the JS CLI from the same monorepo):
npx kensho generate
npx kensho open
```

## CLI flags

```
--kensho-output PATH                Output dir (default: ./kensho-results)
--kensho-project-name STR           Project name in run.json
--kensho-project-slug STR           Project slug (lowercase, alnum + dash/underscore)
--kensho-run-id STR                 Override the auto-generated run id
--kensho-no-severity-from-marks     Don't promote @pytest.mark.<severity> to case.severity
```

`pytest.ini` / `pyproject.toml` `[tool.pytest.ini_options]` keys are also
respected: `kensho_output`, `kensho_project_name`, `kensho_project_slug`.

## What it produces

- `kensho-results/run.json` — run manifest (project, env, totals, timing).
- `kensho-results/cases/<stableId>.json` — one file per test case.
- `kensho-results/attachments/<caseId>/...` — files registered via
  `kensho_pytest.attach`.

Each case gets a **stable id** (`tc_<16 hex>`) hashed from its `nodeid` +
file path, so test history correlates across runs and across adapters
(the JS adapters use the same FNV-1a-based hash).

## Markers we read

| Marker                                          | Effect                                                    |
| ----------------------------------------------- | --------------------------------------------------------- |
| `@pytest.mark.severity('critical')`             | Sets `case.severity`. Allowed values: `blocker`, `critical`, `normal`, `minor`, `trivial`. |
| `@pytest.mark.blocker` / `critical` / `normal` / `minor` / `trivial` | Shorthand alias for the above.    |
| `@pytest.mark.feature('Cart')`                  | Sets `case.behavior.feature`.                             |
| `@pytest.mark.epic('Checkout')`                 | Sets `case.behavior.epic`.                                |
| `@pytest.mark.story('Empty cart shows CTA')`    | Sets `case.behavior.scenario`.                            |
| `@pytest.mark.description('Long-form...')`      | Sets `case.description`.                                  |
| `@pytest.mark.owner('alice')`                   | Sets `case.owner`.                                        |
| `@pytest.mark.kensho_label(team='cart')`        | Adds free-form `key=value` to `case.labels` (string only). |
| `@pytest.mark.kensho_link(kind='jira', url='https://…', label='PROJ-123')` | Adds an entry to `case.links`. |
| `@pytest.mark.parametrize(...)`                 | Each parametrized case gets `case.parameters[]`.          |

Inline `@tag` syntax in test names (`def test_foo_at_smoke()` or
`pytest.param(..., id="x@smoke")`) is also picked up as a tag, mirroring
the JS adapters.

## Helper API

Import the helpers from `kensho_pytest`. All four are no-ops outside a
running test, so it's safe to call them from shared utility code.

```python
import kensho_pytest as kensho

def test_login(page):
    with kensho.step("open the login page"):
        page.goto("/login")

    with kensho.step("submit credentials"):
        page.fill("#user", "demo")
        page.click("text=Sign in")
        # nesting works — child steps roll up under the parent
        with kensho.step("verify redirect"):
            assert page.url.endswith("/home")

    kensho.label("team", "growth")
    kensho.link("https://jira.example.com/browse/PROJ-123",
                kind="jira", label_text="PROJ-123")

    page.screenshot(path="/tmp/login.png")
    kensho.attach("/tmp/login.png", kind="screenshot")
```

| Helper                                    | What it does                                            |
| ----------------------------------------- | ------------------------------------------------------- |
| `with kensho.step(title, action=None):`   | Opens a Kensho step. Nests automatically. On exception the step is marked `fail` and the exception re-raises. |
| `kensho.attach(path, kind=None, name=None, mime_type=None)` | Copies the file into `kensho-results/attachments/<caseId>/` and registers it on the current case (or current step, if one is open). |
| `kensho.label(key, value)`                | Adds a string label to the case.                        |
| `kensho.link(url, kind=None, label_text=None)` | Adds a hyperlink to the case.                       |
| `kensho.current_case_id()`                | Returns the stable case id of the running test, or `None`. |

## Captured output → logs

Pytest's captured stdout / stderr / `caplog` for each phase (setup, call,
teardown) is converted to entries in `case.logs[]`. The `t` field is the
millisecond offset from the test start.

## Errors

`call` failures map to `status: 'fail'`; `setup` / `teardown` failures map
to `status: 'broken'` (these are infrastructure, not real assertion
failures). Skips at any phase map to `status: 'skip'`. The full
`longrepr` is preserved in `case.errors[].stack`; the first line becomes
`case.errors[].message`.

## Environment auto-detected

GitHub Actions, CircleCI, GitLab CI, Jenkins, Buildkite, Azure DevOps —
CI provider, branch, commit, run URL, OS, architecture, Python version.

Pass `KR_AUTHOR`, `KR_COMMIT_MSG`, `KR_STAGE`, `KR_BASE_URL`,
`KR_APP_VERSION`, `KR_BUILD_NUMBER`, `KR_RELEASE`, `KR_REGION`,
`KR_LOCALE`, `KR_TRIGGER`, or `KR_FEATURE` as env vars to populate the
matching fields on `run.env`.

## Design notes

* Zero runtime dependencies beyond `pytest` itself. The schema lives in
  the JS workspace; we vendor the minimum (id-hashing, status mapping,
  env capture) inline so the adapter installs in seconds.
* The reporter never raises out of a hook — a broken adapter must not
  break a test run. All errors come out as `warnings.warn`.
* IDs are stable across adapters: the FNV-1a hash matches the JS
  `stableCaseId` byte-for-byte, so `pytest` and `playwright` runs of
  the same suite roll up to the same history on the platform.

## License

Apache-2.0.
