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
// cypress.config.mjs  (ESM — the kensho task module is ESM)
import { defineConfig } from 'cypress';
import { registerKenshoTasks } from '@kaizenreport/kensho-cypress/task';

export default defineConfig({
  reporter: '@kaizenreport/kensho-cypress',
  reporterOptions: {
    output: 'kensho-results',
    project: { name: 'Acme Web', slug: 'acme-web' },
    severityFromTag: true,
  },
  e2e: {
    setupNodeEvents(on, config) {
      // Required for the `kensho.*` annotation API (Epic/Feature/Severity/…,
      // flaky/muted/knownIssue). The browser ships records to Node via cy.task;
      // this registers the task that persists them for the reporter to merge.
      registerKenshoTasks(on, config);
      return config;
    },
  },
});
```

## Annotation + runtime-marker API

Inside a spec, enrich a test with behavior, ownership, links, parameters, steps
and runtime markers. Calls are no-ops outside a running test.

```js
import { kensho } from '@kaizenreport/kensho-cypress';

it('checks out', () => {
  kensho.Epic('Commerce');
  kensho.Feature('Checkout');
  kensho.Story('Guest checkout');
  kensho.Severity('critical');
  kensho.Owner('payments-team');
  kensho.Description('Guest can purchase without an account.');
  kensho.Tag('@smoke');
  kensho.Link('https://example.com/spec', 'Spec');
  kensho.JiraLink('PROJ-1', 'Tracking');
  kensho.Parameter('currency', 'USD');
  kensho.step('add to cart', () => { /* ... */ });
  // runtime markers
  kensho.flaky();
  kensho.knownIssue('PROJ-42', 'Flaky payment sandbox'); // → muted + issue link
});
```

Both capitalized (`Epic`) and lowercase (`epic`) forms are available. Runtime
values win over tag/attribute-derived metadata.

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
