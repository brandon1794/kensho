# @kaizenreport/kensho-schema

Canonical **Kensho v1** test-result format: JSON Schema + TypeScript types + a
lightweight, dependency-free validator. Every Kensho adapter targets this
contract so the same test correlates across runs and frameworks.

```bash
pnpm add @kaizenreport/kensho-schema
```

```js
import { validateRun, stableCaseId, computeTotals, SCHEMA_VERSION } from '@kaizenreport/kensho-schema';

stableCaseId('tests/login.spec.ts > logs in', 'tests/login.spec.ts'); // tc_...
validateRun(run); // throws on contract violation
```

Exports: `validateRun`, `stableCaseId(fullName, filePath)`, `computeTotals`,
`emptyRun`, `SCHEMA_VERSION`. The raw schema is available at
`@kaizenreport/kensho-schema/schema.json`.

Part of [Kensho](https://github.com/brandon1794/kaizen-reports/tree/main/kensho) ·
Apache-2.0.
