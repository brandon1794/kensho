# @kaizenreport/kensho-jest

A Jest reporter that emits the canonical [Kensho v1](../schema) JSON format.

## Install

```bash
pnpm add -D @kaizenreport/kensho-jest
# or
npm i -D @kaizenreport/kensho-jest
```

## Configure

```js
// jest.config.js
module.exports = {
  reporters: [
    'default',
    ['@kaizenreport/kensho-jest', {
      output: 'kensho-results',
      project: { name: 'Acme API', slug: 'acme-api' },
      severityFromTag: true,
    }],
  ],
};
```

## Annotation + runtime-marker API

Inside a test, enrich the case with behavior, ownership, links, parameters,
steps and runtime markers. Calls are no-ops outside a running test. Jest runs
tests in workers, so annotations are flushed to a sidecar and merged by the
reporter automatically.

```js
import { kensho } from '@kaizenreport/kensho-jest';

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
npx jest
# => kensho-results/ populated with cases/*.json and run.json

npx kensho generate   # → kensho-report/
npx kensho open
```

## What it produces

- `kensho-results/run.json` — manifest (project, env, totals, timing)
- `kensho-results/cases/<stableId>.json` — one per test case
- `kensho-results/attachments/` — empty by default (Jest unit tests rarely
  have attachments; you can capture snapshots or logs yourself if needed)

Each case gets a **stable id** hashed from its fullName + file path for
cross-run correlation. `@blocker` / `@critical` inline tags promote to the
Kensho `severity` field.

## Environment auto-detected

GitHub Actions, CircleCI, GitLab CI, Jenkins, Buildkite — CI provider, branch,
commit, run URL, OS, architecture, Node version.
