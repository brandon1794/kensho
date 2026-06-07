# @kaizenreport/kensho-jasmine

A [Jasmine](https://jasmine.github.io/) reporter that emits the canonical
[Kensho v1](../schema) JSON format. Works for standalone Jasmine runs **and**
Karma (Jasmine is Karma's default test framework).

## Install

```bash
pnpm add -D @kaizenreport/kensho-jasmine
```

## Standalone Jasmine (3 lines)

```js
// spec/helpers/kensho.js (or wherever you wire reporters)
import KenshoJasmineReporter from '@kaizenreport/kensho-jasmine';
jasmine.getEnv().addReporter(new KenshoJasmineReporter({
  project: { name: 'Acme API', slug: 'acme-api' },
}));
```

Then run as usual:

```bash
npx jasmine
npx kensho generate
npx kensho open
```

## Karma (5 lines)

```js
// karma.conf.js
const KenshoJasmineReporter = require('@kaizenreport/kensho-jasmine').default;
module.exports = (config) => config.set({
  frameworks: ['jasmine'],
  reporters: ['progress'],
  plugins: [{ 'reporter:kensho': ['type', () => new KenshoJasmineReporter({ project: { name: 'Acme Web', slug: 'acme-web' } })] }],
});
```

(Karma's plugin shape varies by version — for older Karma, register the
reporter inside `beforeEach(() => jasmine.getEnv().addReporter(...))` from a
spec helper file added to `config.files`.)

## Helper API — `kensho.step` / `attach` / `label` / `link`

```js
import { kensho } from '@kaizenreport/kensho-jasmine';

it('checks out cart', async () => {
  await kensho.step('open cart', async () => { /* … */ });
  await kensho.step('apply discount', async () => {
    await kensho.step('verify total', async () => { /* nested */ });
  });
  kensho.label('team', 'growth');
  kensho.link('https://jira.example.com/browse/PROJ-123', { kind: 'jira', label: 'PROJ-123' });
  kensho.attach('/tmp/cart.png', { kind: 'screenshot' });
});
```

## What we capture

| Jasmine concept                   | Kensho field          |
| --------------------------------- | --------------------- |
| `describe(...)` chain             | `case.suite[]`        |
| `it('@critical login', …)` tags   | `case.tags[]`, `case.severity` |
| `passed`/`failed`/`pending`/`excluded` | `case.status`     |
| `failedExpectations[]`            | `case.errors[]` + sub-step with `step.assertion` |
| `pending('blocker reason')`       | `case.severity` (extracted from reason) |
| `console.log/warn/error` during a spec | `case.logs[]`    |
| `kensho.step(…)`                  | `case.steps[]` (nests) |
| `kensho.attach(path, …)`          | `case.attachments[]` (file copied to `kensho-results/attachments/<id>/`) |
| `kensho.label(k, v)` / `link(…)`  | `case.labels{}`, `case.links[]` |

Each case gets a **stable id** hashed from `fullName + filePath` for
cross-run correlation.

## Options

```ts
new KenshoJasmineReporter({
  output?: string,                 // default 'kensho-results'
  project?: { name, slug, url },
  severityFromTag?: boolean,       // default true — promote @critical tags
  runId?: string,                  // override the auto-generated id
  filePath?: string,               // fallback when Jasmine doesn't expose result.filename
})
```
