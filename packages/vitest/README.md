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

## Annotation + runtime-marker API

Inside a test, enrich the case with behavior, ownership, links, parameters,
steps and runtime markers. Calls are no-ops outside a running test. Vitest runs
tests in workers, so annotations are flushed to a sidecar and merged by the
reporter automatically.

```ts
import { kensho } from '@kaizenreport/kensho-vitest';

test('logs in', async () => {
  kensho.Epic('Auth');
  kensho.Feature('Login');
  kensho.Story('Happy path');
  kensho.Severity('critical');
  kensho.Owner('auth-team');
  kensho.Description('A registered user can sign in.');
  kensho.Tag('@smoke');
  kensho.Link('https://example.com/spec', 'Spec');
  kensho.JiraLink('PROJ-1', 'Tracking');
  kensho.Parameter('env', 'staging');
  await kensho.step('submit form', async () => { /* ... */ });
  kensho.flaky();
  kensho.knownIssue('PROJ-42'); // → muted + issue link
});
```

Both capitalized (`Epic`) and lowercase (`epic`) forms are available. Runtime
values win over tag-derived metadata.

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
