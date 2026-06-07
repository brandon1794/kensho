# k6-demo

End-to-end demo of [`@kaizenreport/kensho-k6`](../../packages/k6).

## Run with real k6

```bash
k6 run script.js
npx kensho generate
npx kensho open
```

k6 will write `kensho-results/run.json` + `kensho-results/cases/<id>.json`
to the working directory. (The summary helper returns an object whose keys
are file paths; k6's `handleSummary` writes them automatically.)

## Run without k6

The seed script feeds a fixture k6-summary object directly into
`kenshoSummary()`:

```bash
pnpm install
pnpm run seed
pnpm run validate
pnpm run generate
```

## What the demo proves

* Two scenarios (`smoke`, `soak`) → two Kensho cases. Each scenario's
  `check(...)` calls become sub-steps.
* `'rate>0.95'` for `checks` → top-level **threshold case** with status
  `pass` (k6 `ok: true`).
* `'p(95)<500'` for `http_req_duration` → top-level threshold case with
  status `fail` (k6 `ok: false`); the assertion records expected expression
  vs observed metric.
* Opt-in `data.kenshoSamples` (HTTP samples populated by the user from a
  custom output stream) → `step.request{}` + `step.response{}` rendered by
  the viewer's HTTP step UI.
* Run-level metrics (`http_req_duration`, `http_reqs`, `iterations`,
  `vus_max`, `data_sent`, `data_received`, `checks`) are flattened into
  `run.env.vars` so the dashboard surfaces them as project-level numbers.
