# @kaizenreport/kensho-k6

Kensho summary helper for [k6](https://k6.io/). k6 has its own JS runtime
(Goja) so we can't ship a "reporter plugin" in the conventional sense —
instead, you import this tiny self-contained module from your k6 script's
`handleSummary(data)` and return the result. k6 writes the files for you.

## Install

```bash
pnpm add -D @kaizenreport/kensho-k6 @kaizenreport/kensho
```

(Or, if you prefer not to bundle: copy `dist/index.mjs` next to your script
and import it directly. The file is self-contained — zero external deps.)

## Usage

```js
// script.js
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { kenshoSummary } from '@kaizenreport/kensho-k6';

export const options = {
  scenarios: {
    smoke: {
      executor: 'constant-vus', vus: 5, duration: '10s',
      exec: 'smoke',
    },
    soak: {
      executor: 'ramping-vus', stages: [
        { duration: '5s', target: 10 },
        { duration: '20s', target: 10 },
      ],
      exec: 'soak',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed:   ['rate<0.01'],
    checks:            ['rate>0.95'],
  },
};

export function smoke() {
  group('smoke / GET /products', () => {
    const r = http.get('https://test.k6.io/products');
    check(r, {
      'status is 200': (r) => r.status === 200,
      'body has items': (r) => r.body.includes('item'),
    });
  });
}

export function soak() {
  group('soak / GET /', () => {
    const r = http.get('https://test.k6.io/');
    check(r, { 'status is 200': (r) => r.status === 200 });
  });
}

export function handleSummary(data) {
  return kenshoSummary(data, {
    project: { name: 'API perf', slug: 'api-perf' },
  });
}
```

```bash
k6 run script.js
npx kensho generate
npx kensho open
```

## What we capture

| k6 concept                                | Kensho mapping                                    |
| ----------------------------------------- | ------------------------------------------------- |
| Each scenario in `options.scenarios`      | One Kensho **case** named after the scenario      |
| Each `check(...)` inside a scenario       | A sub-step on the scenario case (`step.assertion` populated on failure) |
| Each `threshold` (e.g. `http_req_duration: ['p(95)<500']`) | One **top-level case** — pass if `result.ok`, fail otherwise. Labeled `behavior.feature = 'thresholds'`. |
| Run-level metrics (`http_req_duration`, `iterations`, `vus_max`, `data_sent`, `data_received`, `checks`) | Flattened into `run.env.vars` (avg / p95 / count / rate keys) |
| Per-iteration HTTP samples (opt-in via `data.kenshoSamples`) | `step.request{}` + `step.response{}` on the scenario, capped at `opts.maxSteps` (default 50) |

A scenario case is `pass` when all of its checks pass and `fail` when any
check fails. A threshold case is `pass` when k6 reports `result.ok === true`
and `fail` otherwise — these are surfaced as **separate cases** so the
viewer's pass/fail counts include performance gates as first-class results.

## Options

```ts
kenshoSummary(data, {
  project?: { name, slug, url },
  runId?: string,
  maxSteps?: number,             // default 50 — cap per-iteration samples
  output?: string,               // default 'kensho-results' (file-key prefix)
  framework?: { name, version },
  env?: object,                  // merged into run.env
})
```

## Schema reference

The full Kensho v1 schema lives at
[`@kaizenreport/kensho-schema`](../schema). The summary object this helper
returns matches the format the Kensho CLI's `validate` and `generate`
commands expect.
