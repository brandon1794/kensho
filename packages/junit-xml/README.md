# @kaizenreport/kensho-junit-xml

A universal **JUnit XML → Kensho** converter. Many test frameworks (pytest,
gradle, jest-junit, mocha-junit-reporter, phpunit, nunit, …) emit JUnit XML,
so this acts as a framework-agnostic fallback to feed the Kensho report
generator.

## Install

```bash
pnpm add -D @kaizenreport/kensho-junit-xml
# or
npm i -D @kaizenreport/kensho-junit-xml
```

## CLI

```bash
npx kensho-junit --input reports/junit.xml --output kensho-results \
  --project-name "Acme API" --project-slug acme-api

npx kensho generate   # → kensho-report/
npx kensho open
```

Multiple inputs are merged into one `kensho-results/`:

```bash
npx kensho-junit \
  --input reports/backend.xml \
  --input reports/frontend.xml \
  --output kensho-results
```

## Programmatic

```js
import { convertJUnit } from '@kaizenreport/kensho-junit-xml';

convertJUnit(['reports/junit.xml'], 'kensho-results', {
  project: { name: 'Acme API', slug: 'acme-api' },
});
```

## What it produces

- `kensho-results/run.json` — manifest
- `kensho-results/cases/<stableId>.json` — one per `<testcase>`
- `kensho-results/attachments/` — empty (JUnit XML has no attachment concept,
  only `<system-out>` / `<system-err>`, which land under `logs`)

## Example framework integrations

- **pytest**: `pytest --junitxml=reports/junit.xml`
- **gradle**: test task writes XML to `build/test-results/test/*.xml`
- **jest-junit**: `jest --reporters=jest-junit`
- **mocha-junit-reporter**: `mocha --reporter mocha-junit-reporter`

Feed any of those into `kensho-junit`.
