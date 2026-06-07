# @kaizenreport/kensho-cucumber-js

A Cucumber-JS custom formatter that emits the canonical [Kensho v1](../schema)
JSON format. Subscribes to the message envelope stream, so every scenario
becomes a Kensho case and every step becomes a Kensho step.

## Install

```bash
pnpm add -D @kaizenreport/kensho-cucumber-js
# or
npm i -D @kaizenreport/kensho-cucumber-js
```

## Configure

Pass the formatter via `--format` on the CLI or via a config file:

```bash
npx cucumber-js \
  --format @kaizenreport/kensho-cucumber-js \
  --format-options '{"output":"kensho-results","project":{"name":"Acme BDD","slug":"acme-bdd"}}'
```

Or in `cucumber.js`:

```js
// cucumber.js
module.exports = {
  default: {
    format: ['@kaizenreport/kensho-cucumber-js'],
    formatOptions: {
      output: 'kensho-results',
      project: { name: 'Acme BDD', slug: 'acme-bdd' },
      severityFromTag: true,
    },
  },
};
```

## What it produces

- `kensho-results/run.json` — manifest (project, env, totals, timing)
- `kensho-results/cases/<stableId>.json` — one per **scenario**
  - `behavior.feature` / `behavior.scenario` are populated from the Gherkin source
  - Scenario tags (`@smoke`, `@critical`) become Kensho tags / severity
- `kensho-results/attachments/` — empty by default

Gherkin steps (`Given` / `When` / `Then`) appear as Kensho steps under each
case, with individual pass/fail/skip status and durations.

## Environment auto-detected

GitHub Actions, CircleCI, GitLab CI, Jenkins, Buildkite — CI provider, branch,
commit, run URL, OS, architecture, Node version.
