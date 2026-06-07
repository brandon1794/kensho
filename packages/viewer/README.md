# @kaizenreport/kensho-viewer

The static HTML/JS/CSS report viewer that `@kaizenreport/kensho generate` bundles
into every report. You normally never install this directly — the CLI does. It is
published so the Kaizen platform can embed the same viewer as a component.

```bash
pnpm add @kaizenreport/kensho-viewer
```

```js
// Embeddable React component (optional peer deps: react, react-dom)
import { KenshoViewer } from '@kaizenreport/kensho-viewer/component';
```

CSS prefix: `kv-*`. Build is run automatically on `prepack`.

Part of [Kensho](https://github.com/brandon1794/kaizen-reports/tree/main/kensho) ·
Apache-2.0.
