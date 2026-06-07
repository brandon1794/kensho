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
