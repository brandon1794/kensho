# kensho-cucumber-ruby

A Cucumber 7+ formatter that emits the canonical [Kensho v1](../schema)
JSON format. Run your suite, point the `kensho` CLI at `kensho-results/`,
and get a self-contained static HTML report.

## Install

```ruby
# Gemfile
gem 'cucumber'
gem 'kensho-cucumber-ruby', require: false, group: :test
```

```bash
bundle install
```

## Run

```bash
bundle exec cucumber --require kensho/cucumber --format Kensho::Cucumber::Formatter

# render the HTML report (uses the JS CLI from the same monorepo):
npx kensho generate
npx kensho open
```

You can pin the formatter from `cucumber.yml`:

```yaml
default: --require kensho/cucumber --format Kensho::Cucumber::Formatter --format pretty
```

## What it produces

- `kensho-results/run.json` — run manifest (project, env, totals, timing).
- `kensho-results/cases/<stableId>.json` — one file per scenario.
- `kensho-results/attachments/<caseId>/...` — anything `attach`ed in a step.

Each case gets a **stable id** (`tc_<16 hex>`) hashed from
`feature › scenario` + file path so test history correlates across runs
and across adapters (the JS adapters use the same FNV-1a-based hash).

## Mapping

| Gherkin                                   | Kensho field                              |
| ----------------------------------------- | ----------------------------------------- |
| Feature                                   | `case.behavior.feature` and `case.suite[0]` |
| Rule (parent of the scenario)             | `case.behavior.epic`                      |
| Scenario name                             | `case.name` and `case.behavior.scenario`  |
| Each Given/When/Then                      | one entry in `case.steps[]` (`title` includes the keyword) |
| Data table on a step                      | `step.parameters[]` (kind: data-row)      |
| Doc string on a step                      | `step.parameters[]` (kind: argument)      |

## Tag conventions

| Tag                                    | Effect                                                 |
| -------------------------------------- | ------------------------------------------------------ |
| `@critical`, `@blocker`, `@normal`, `@minor`, `@trivial` | Sets `case.severity`.                  |
| `@severity:critical`                   | Same as above, explicit form.                          |
| `@kensho.label.<key>=<value>`          | Adds `case.labels.<key> = '<value>'`.                  |
| `@kensho.link.<kind>=<label>`          | Adds `case.links += { kind, label, url: label }`. Use for ticket IDs. |
| `@kensho.url.<kind>=<https://…>`       | Adds `case.links += { kind, url }`. Use for full URLs. |
| any other `@tag`                       | Becomes a tag on `case.tags`.                          |

```gherkin
@critical @smoke @kensho.label.team=growth @kensho.link.jira=PROJ-123
Scenario: User can log in
  Given a registered user
  When  they submit valid credentials
  Then  they land on the home page
```

## Status mapping

| Cucumber outcome              | Kensho status |
| ----------------------------- | ------------- |
| passed                        | `pass`        |
| failed                        | `fail`        |
| pending                       | `skip`        |
| skipped                       | `skip`        |
| undefined / ambiguous         | `broken`      |

## Environment auto-detected

GitHub Actions, CircleCI, GitLab CI, Jenkins, Buildkite, Azure DevOps —
CI provider, branch, commit, run URL, OS, architecture, Ruby version.

Pass `KR_AUTHOR`, `KR_COMMIT_MSG`, `KR_STAGE`, `KR_BASE_URL`,
`KR_APP_VERSION`, `KR_BUILD_NUMBER`, `KR_RELEASE`, `KR_REGION`,
`KR_LOCALE`, `KR_TRIGGER`, or `KR_FEATURE` as env vars to populate the
matching fields on `run.env`.

## CLI / env flags

```
KENSHO_OUTPUT          output dir (default ./kensho-results)
KENSHO_PROJECT_NAME    project name in run.json
KENSHO_PROJECT_SLUG    project slug
KENSHO_RUN_ID          override the auto-generated run id
```

## Design notes

- Zero runtime dependencies beyond `cucumber` itself. The schema lives
  in the JS workspace; we vendor the minimum (id-hashing, env capture)
  inline so the gem installs in seconds.
- The formatter never raises — broken adapters must not break a test
  run.
- Stable IDs match the JS `stableCaseId` byte-for-byte, so
  `cucumber-ruby` and `cucumber-js` runs of the same `.feature` file
  roll up to the same history on the platform.

## License

Apache-2.0.
