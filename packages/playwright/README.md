# @kaizenreport/kensho-playwright

A Playwright reporter that emits the canonical [Kensho v1](../schema) JSON format, so the Kensho CLI can generate a beautiful static report (and optionally upload to the KaizenReport platform).

## Install

```bash
pnpm add -D @kaizenreport/kensho-playwright
# or
npm i -D @kaizenreport/kensho-playwright
```

## Configure

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['line'], // keep your existing console reporter
    ['@kaizenreport/kensho-playwright', {
      output: 'kensho-results',
      project: { name: 'Acme Web', slug: 'acme-web' },
      severityFromTag: true, // @blocker / @critical / @normal / @minor / @trivial
    }],
  ],
});
```

## Run

```bash
npx playwright test
# => kensho-results/ populated with cases/*.json, run.json, attachments/…

npx kensho generate     # → kensho-report/
npx kensho open
```

## What you get

- `kensho-results/run.json` — manifest (project, env, totals, timing)
- `kensho-results/cases/<stableId>.json` — one per test case
- `kensho-results/attachments/<stableId>/…` — screenshots, videos, traces

Every test gets a **stable id** hashed from its fullName + file path, so the same test across runs correlates for history & flakiness detection.

## Environment auto-detected

- GitHub Actions, CircleCI, GitLab CI, Jenkins, Buildkite — CI provider + branch + commit + runUrl
- OS, architecture, Node version
- Per-test browser, worker index, retry attempt number

## Annotations → Kensho labels

```ts
test.info().annotations.push({ type: 'owner', description: '@mchen' });
test.info().annotations.push({ type: 'jira', description: 'ACME-1234' });
```

Show up as `owner` and `labels.jira` in the case JSON.
