# @kaizenreport/kensho-cypress

A Cypress reporter that emits the canonical [Kensho v1](../schema) JSON format. Cypress uses Mocha under the hood, so this reporter plugs in via the standard Mocha reporter API.

## Install

```bash
pnpm add -D @kaizenreport/kensho-cypress
# or
npm i -D @kaizenreport/kensho-cypress
```

## Configure

```js
// cypress.config.js
const { defineConfig } = require('cypress');

module.exports = defineConfig({
  reporter: '@kaizenreport/kensho-cypress',
  reporterOptions: {
    output: 'kensho-results',
    project: { name: 'Acme Web', slug: 'acme-web' },
    severityFromTag: true,
  },
});
```

## Run

```bash
npx cypress run
# => kensho-results/ populated with cases/*.json and run.json

npx kensho generate   # → kensho-report/
npx kensho open
```

## What it produces

- `kensho-results/run.json` — run manifest (project, env, totals, timing)
- `kensho-results/cases/<stableId>.json` — one per test case
- `kensho-results/attachments/` — empty by default (Cypress screenshots/videos
  are handled per-spec; wire a `cy.task()` hook if you want to copy them in).

Each test gets a **stable id** hashed from its fullName + file path, so the
same test correlates across runs for history and flakiness tracking.

## Environment auto-detected

GitHub Actions, CircleCI, GitLab CI, Jenkins, Buildkite — CI provider, branch,
commit, run URL, OS, architecture, Node version.
