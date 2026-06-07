# Contributing to Kensho

Thanks for helping improve Kensho! Issues and pull requests are welcome.

## Project layout

Kensho is a **pnpm** workspace (Node ≥ 22). Non-JS adapters live alongside the
JS ones (Python via `pyproject.toml`, Java via `pom.xml`, .NET via `.csproj`,
Ruby via `gemspec`).

```
packages/   schema · cli · viewer + every framework adapter
examples/   one runnable demo per adapter
```

## Getting started

```bash
corepack enable pnpm        # if needed
pnpm install
cd examples/playwright-demo && pnpm run demo   # seed → generate → open
```

## The adapter contract

Every adapter must:

1. Write the **Kensho v1** schema — pass `npx kensho validate <results-dir>`.
2. Match `stableCaseId` byte-for-byte (double FNV-1a of `<fullName>::<filePath>`,
   prefix `tc_`, 16 hex chars). See `packages/schema`.
3. Map status as `pass | fail | skip | broken`.
4. Expose the helper API where applicable: `step` · `attach` · `label` · `link`.

Before opening a PR for adapter or core changes:

```bash
pnpm --filter @kaizenreport/kensho-viewer run build   # if you touched the viewer
# from a demo dir:
pnpm run validate && pnpm run generate
```

## Pull requests

- Branch from `main`; PRs require a passing CI check + maintainer review.
- Keep changes focused; match the surrounding code style.
- For a new adapter, add a matching `examples/<adapter>-demo/`.
- Don't commit `kensho-results/`, `kensho-report/`, or `node_modules/`.

## Releasing

Releases are automated via the `release-*` workflows (npm, PyPI, Maven, NuGet,
RubyGems) and are run by maintainers.

## Code of Conduct

By participating you agree to our [Code of Conduct](./CODE_OF_CONDUCT.md).
