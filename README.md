# Kensho — 検証

**Open-source test report generator. Apache-2.0. Part of the KaizenReport platform.**

Inspired by Allure Report, Playwright HTML report, and Cucumber Report — combines the best of all three and adds what none of them have:

- **Beautiful.** Sidebar layout, mosaic overview widgets, dark mode, polished typography.
- **Fast.** Viewer is pure vanilla JS, no framework — boots in <100 ms even with 10k+ tests.
- **Framework-agnostic.** Canonical [Kensho v1](./packages/schema/schema.json) format. One format, every language.
- **Customizable.** Drop a `kensho.config.json` next to your results to rebrand, hide tabs, set accent color, register failure categories.
- **Real steps.** Nested step trees with Setup / Test body / Tear down grouping, per-step logs + attachments + parameters.
- **History + retries** as top-level detail tabs on every test case.
- **Dogfoodable.** Install → run tests → `kensho generate` → open. No server, no account.

## Packages

| Package | Purpose |
|---|---|
| [`@kaizenreport/kensho-schema`](./packages/schema) | Canonical JSON Schema + TS types + validator. |
| [`@kaizenreport/kensho-playwright`](./packages/playwright) | Playwright reporter. Writes `kensho-results/`. |
| [`@kaizenreport/kensho-go`](./packages/go) | Convert `go test -json` → `kensho-results/` (+ optional Go helper module for steps/attachments). |
| [`kensho-pytest`](./packages/pytest) | pytest plugin (Python). |
| [`kensho-robot`](./packages/robot) | Robot Framework Listener v3 (Python). |
| [`@kaizenreport/kensho`](./packages/cli) | CLI: `generate` · `open` · `validate`. |
| [`@kaizenreport/kensho-viewer`](./packages/viewer) | Static HTML + JS + CSS viewer copied into every report. |

## Try the demo

```bash
pnpm install
cd examples/playwright-demo
pnpm run demo   # seed → generate → open
```

Opens a full Kensho report in your browser with 10 realistic test cases — pass, fail, skip, with screenshots, traces, logs, assertion diffs. No Playwright browsers required.

## Install in your project

```bash
pnpm add -D @kaizenreport/kensho-playwright @kaizenreport/kensho
```

```ts
// playwright.config.ts
export default {
  reporter: [
    ['line'],
    ['@kaizenreport/kensho-playwright', {
      output: 'kensho-results',
      project: { name: 'My App', slug: 'my-app' },
      severityFromTag: true,
    }],
  ],
};
```

```bash
npx playwright test
npx kensho generate
npx kensho open
```

## Customize

Drop `kensho.config.json` in your repo root:

```json
{
  "brand": { "name": "Acme Test Report", "tagline": "QA", "accent": "#2563EB" },
  "project": { "name": "Acme Web", "slug": "acme", "url": "https://github.com/acme/web" },
  "tabs": {
    "overview":    true,
    "suites":      true,
    "categories":  true,
    "graphs":      true,
    "timeline":    true,
    "behaviors":   false,
    "environment": true
  },
  "redact": ["^SECRET_", "TOKEN$"]
}
```

## Upload to KaizenReport (optional)

```bash
npx kensho upload --project acme-web --token $KR_TOKEN
```

The platform gives you cross-run history, flakiness detection, failure clustering, team dashboards, Slack / Jira / GitHub integrations.

## Schema

Every reporter emits `kensho/v1` JSON. See [`packages/schema/schema.json`](./packages/schema/schema.json) for the full contract. Highlights:

- Stable case IDs (FNV-1a hash of `fullName + filePath`) correlate the same test across runs.
- Every step can have its own `attachments`, `logs`, `network`, `parameters`, `children` (nested steps), `assertion`.
- `parameters` on a case capture data-driven inputs (perfect for Cucumber scenario outlines + parameterized unit tests).
- `behavior.epic / feature / scenario / gherkin` for BDD.
- All dates ISO, all durations integer milliseconds.

## Why "Kensho"?

検証 means *verification* in Japanese — literally what test reports are for. Fits the Kaizen (改善, "continuous improvement") family.

## License

Apache-2.0.
