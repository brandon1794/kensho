# @kaizenreport/kensho-vitest

A Vitest custom reporter that emits the canonical [Kensho v1](../schema) JSON format.

## Install

```bash
pnpm add -D @kaizenreport/kensho-vitest
# or
npm i -D @kaizenreport/kensho-vitest
```

## Configure

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import KenshoReporter from '@kaizenreport/kensho-vitest';

export default defineConfig({
  test: {
    reporters: [
      'default',
      new KenshoReporter({
        output: 'kensho-results',
        project: { name: 'Acme API', slug: 'acme-api' },
        severityFromTag: true,
      }),
    ],
  },
});
```

## Run

```bash
npx vitest run
# => kensho-results/ populated

npx kensho generate   # → kensho-report/
npx kensho open
```

## What it produces

- `kensho-results/run.json` — manifest (project, env, totals, timing)
- `kensho-results/cases/<stableId>.json` — one per test
- `kensho-results/attachments/` — empty by default (Vitest tests rarely produce
  artifacts; you can add them post-hoc if your setup captures any)

Stable ids are hashed from fullName + file path so tests correlate across runs.
Nested `test.each` / custom tasks become Kensho **steps** inside the parent.

## Environment auto-detected

GitHub Actions, CircleCI, GitLab CI, Jenkins, Buildkite — CI provider, branch,
commit, run URL, OS, architecture, Node version.
